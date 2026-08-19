/**
 * Closed-corpus lookup: a listing title plus a handful of metadata in, a resolution out.
 *
 * No network, no clock, no learned model. Same inputs produce the same object. eBay's terms
 * bar training on their content, so this is a lookup over strings we already hold, not a
 * guess at strings we have seen.
 *
 * Card grain is the ordinary case. A title that names a card and leaves several printings
 * live resolves to the card and carries the candidates. A variant is returned only when the
 * title (or an owner-authored alias) leaves exactly one printing standing.
 */

import { COPY_GRADERS, type CopyGrader, parseGradeTenths } from "../../shared/copies.ts";
import {
	type ListingMatchInput,
	type ListingResolution,
	MATCHER_VERSION,
	type MatcherAlias,
	type MatcherCard,
	type MatcherCorpus,
	type MatcherVariant,
	type VariantCandidate,
} from "../../shared/matcher.ts";
import { canonicaliseAxisValue, slugifyAxisValue } from "../corpus/canonical.ts";

type LanguageSource = "marker" | "country" | "default";

interface Evidence {
	readonly matchedSet: boolean;
	readonly matchedNumber: boolean;
	readonly narrowedVariant: boolean;
}

const LANGUAGE_DEFAULT_PENALTY = 0.12;

const COUNTRY_LANGUAGE: Readonly<Record<string, string>> = {
	AU: "en",
	US: "en",
	GB: "en",
	CA: "en",
	NZ: "en",
	IE: "en",
	SG: "en",
	ZA: "en",
	JP: "ja",
	DE: "de",
	AT: "de",
	FR: "fr",
	IT: "it",
	ES: "es",
	MX: "es",
	AR: "es",
	PT: "pt",
	BR: "pt",
	KR: "ko",
	CN: "zh-cn",
	TW: "zh-tw",
	HK: "zh-tw",
	NL: "nl",
	PL: "pl",
	ID: "id",
	TH: "th",
};

/**
 * Title-language markers. Ordered so a more specific phrase wins: "Traditional Chinese"
 * before "Chinese", "Japanese" before a generic CJK catch.
 */
const LANGUAGE_MARKERS: readonly { readonly language: string; readonly pattern: RegExp }[] = [
	{ language: "ja", pattern: /\bjapanese\b|\bjpn\b|\bjp\b|日本語|ポケモンカード|ポケカ/i },
	{ language: "de", pattern: /\bgerman\b|\bdeutsch\b|\bger\b/i },
	{ language: "fr", pattern: /\bfrench\b|\bfran[cç]ais\b|\bfre\b/i },
	{ language: "it", pattern: /\bitalian\b|\bitaliano\b/i },
	{ language: "es", pattern: /\bspanish\b|\bespa[nñ]ol\b/i },
	{ language: "pt", pattern: /\bportuguese\b|\bportugu[eê]s\b/i },
	{ language: "ko", pattern: /\bkorean\b|한국어|한글/i },
	{ language: "zh-tw", pattern: /traditional\s+chinese|繁體|繁体/i },
	{ language: "zh-cn", pattern: /simplified\s+chinese|简体/i },
	{ language: "zh-cn", pattern: /\bchinese\b|中文|\bchn?\b/i },
	{ language: "th", pattern: /\bthai\b|ไทย/i },
	{ language: "id", pattern: /\bindonesian\b|\bbahasa\b/i },
	{ language: "nl", pattern: /\bdutch\b|\bnederlands\b/i },
	{ language: "pl", pattern: /\bpolish\b|\bpolski\b/i },
	{ language: "en", pattern: /\benglish\b|\beng\b|\banglais\b/i },
];

const LOT_KEYWORD = /\b(?:lot|bundle|bulk|collection)\b/i;
const LOT_COUNT = /\bx\s*\d{2,}\b|\b\d{2,}\s*x\b/i;

const PROXY_TITLE =
	/\b(?:proxy|proxies|custom\s*art|custom[- ]made|altered\s*art|fake|replica|not\s*authentic)\b/i;

const GRADE_PHRASE =
	/\b(PSA|BGS|CGC|SGC|ACE)\s*(?:pristine\s*)?(\d{1,2}(?:\.\d)?)(?:\s*black\s*label)?/i;

// Number patterns are constructed per call. A module-level `/g` regex keeps `lastIndex`
// and would make the second resolve of the same title miss the number.

const FIRST_EDITION = /\b(?:1st|first)[-\s]?ed(?:ition)?\b/i;
const UNLIMITED = /\bunlimited\b/i;
const SHADOWLESS = /\bshadowless(?:[-\s]?red[-\s]?cheek)?\b/i;
const REVERSE = /\breverse(?:[-\s]?holo(?:foil)?|[- ]h)?\b/i;
const HOLO = /\bholo(?:graphic|foil)?\b/i;
const NON_HOLO = /\bnon[-\s]?holo(?:graphic|foil)?\b/i;

export function resolveListing(
	input: ListingMatchInput,
	corpus: MatcherCorpus,
	aliases: readonly MatcherAlias[] = [],
): ListingResolution {
	const title = input.title;
	const grade = parseGrade(title);
	const workingTitle = stripGrade(title);
	const filter = detectFilter(title, input.aspects);
	const language = detectLanguage(workingTitle, input.itemLocationCountry);

	const lotNames = detectLotNames(workingTitle, corpus);
	const isLot =
		lotNames.length >= 2 || LOT_KEYWORD.test(workingTitle) || LOT_COUNT.test(workingTitle);

	if (isLot) {
		return resolution({
			grain: "none",
			language: language.language,
			confidence: scoreNone({ isLot: true, languageSource: language.source }),
			isLot: true,
			lotNames: uniqueSorted(
				lotNames.length > 0 ? lotNames : extractLotKeywordNames(workingTitle, corpus),
			),
			filter,
			grade,
		});
	}

	const aliasHit = findAlias(workingTitle, aliases, corpus);
	if (aliasHit !== null) {
		return finishCard(
			aliasHit.card,
			workingTitle,
			language,
			filter,
			grade,
			{
				matchedSet: true,
				matchedNumber: true,
				narrowedVariant: aliasHit.forcedVariant !== null,
			},
			aliasHit.forcedVariant,
		);
	}

	const named = cardsNamedIn(workingTitle, corpus);
	if (named.length === 0) {
		return resolution({
			grain: "none",
			language: language.language,
			confidence: scoreNone({ isLot: false, languageSource: language.source }),
			isLot: false,
			lotNames: null,
			filter,
			grade,
		});
	}

	const withSet = prefer(named, (card) => setMentioned(workingTitle, card));
	const withNumber = prefer(withSet, (card) => numberMentioned(workingTitle, card));
	const withLanguage = prefer(withNumber, (card) => card.language === language.language);

	if (withLanguage.length !== 1) {
		return resolution({
			grain: "none",
			language: language.language,
			confidence: scoreNone({ isLot: false, languageSource: language.source }),
			isLot: false,
			lotNames: null,
			filter,
			grade,
		});
	}

	const card = withLanguage[0];
	if (card === undefined) {
		return resolution({
			grain: "none",
			language: language.language,
			confidence: scoreNone({ isLot: false, languageSource: language.source }),
			isLot: false,
			lotNames: null,
			filter,
			grade,
		});
	}

	return finishCard(
		card,
		workingTitle,
		language,
		filter,
		grade,
		{
			matchedSet:
				withSet.length < named.length || named.every((entry) => setMentioned(workingTitle, entry)),
			matchedNumber:
				withNumber.length < withSet.length ||
				withSet.every((entry) => numberMentioned(workingTitle, entry)),
			narrowedVariant: false,
		},
		null,
	);
}

function finishCard(
	card: MatcherCard,
	title: string,
	language: { readonly language: string; readonly source: LanguageSource },
	filter: { readonly verdict: ListingResolution["filterVerdict"]; readonly reason: string | null },
	grade: { readonly grader: CopyGrader | null; readonly grade: number | null },
	evidence: Evidence,
	forcedVariant: MatcherVariant | null,
): ListingResolution {
	const remaining =
		forcedVariant !== null ? [forcedVariant] : filterVariants(card.variants, parsePrintCues(title));

	const usable = remaining.length > 0 ? remaining : [...card.variants];
	const sorted = sortVariants(usable);
	const narrowed = forcedVariant !== null || (remaining.length === 1 && card.variants.length > 1);

	if (sorted.length === 1) {
		const variant = sorted[0];
		if (variant === undefined) {
			return cardGrain(card, sortVariants(card.variants), language, filter, grade, evidence);
		}
		return resolution({
			grain: "variant",
			cardKey: card.cardKey,
			variantId: variant.variantId,
			candidates: null,
			language: card.language,
			confidence: scoreMatch({
				...evidence,
				narrowedVariant: narrowed,
				languageSource: language.source,
				grain: "variant",
			}),
			isLot: false,
			lotNames: null,
			filter,
			grade,
		});
	}

	return cardGrain(card, sorted, language, filter, grade, { ...evidence, narrowedVariant: false });
}

function cardGrain(
	card: MatcherCard,
	candidates: readonly MatcherVariant[],
	language: { readonly language: string; readonly source: LanguageSource },
	filter: { readonly verdict: ListingResolution["filterVerdict"]; readonly reason: string | null },
	grade: { readonly grader: CopyGrader | null; readonly grade: number | null },
	evidence: Evidence,
): ListingResolution {
	return resolution({
		grain: "card",
		cardKey: card.cardKey,
		variantId: null,
		candidates: candidates.map((variant) => toCandidate(card.cardKey, variant)),
		language: card.language,
		confidence: scoreMatch({ ...evidence, languageSource: language.source, grain: "card" }),
		isLot: false,
		lotNames: null,
		filter,
		grade,
	});
}

function resolution(partial: {
	readonly grain: ListingResolution["grain"];
	readonly cardKey?: string | null;
	readonly variantId?: string | null;
	readonly candidates?: readonly VariantCandidate[] | null;
	readonly language: string;
	readonly confidence: number;
	readonly isLot: boolean;
	readonly lotNames: readonly string[] | null;
	readonly filter: {
		readonly verdict: ListingResolution["filterVerdict"];
		readonly reason: string | null;
	};
	readonly grade: { readonly grader: CopyGrader | null; readonly grade: number | null };
}): ListingResolution {
	const grain = partial.grain;
	return {
		grain,
		cardKey: grain === "none" ? null : (partial.cardKey ?? null),
		variantId: grain === "variant" ? (partial.variantId ?? null) : null,
		candidates: grain === "card" ? (partial.candidates ?? []) : null,
		language: partial.language,
		confidence: clampConfidence(partial.confidence),
		matcherVersion: MATCHER_VERSION,
		isLot: partial.isLot,
		lotNames: partial.isLot ? (partial.lotNames ?? []) : null,
		filterVerdict: partial.filter.verdict,
		filterReason:
			partial.filter.verdict === "filtered" ? (partial.filter.reason ?? "filtered") : null,
		parsedGrader: partial.grade.grader,
		parsedGrade: partial.grade.grade,
	};
}

function toCandidate(cardKey: string, variant: MatcherVariant): VariantCandidate {
	return {
		cardKey,
		variantId: variant.variantId,
		finish: variant.finish,
		subtype: variant.subtype,
		stamps: variant.stamps,
		foil: variant.foil,
		size: variant.size,
	};
}

function sortVariants(variants: readonly MatcherVariant[]): MatcherVariant[] {
	return [...variants].sort((a, b) => {
		if (a.variantId < b.variantId) return -1;
		if (a.variantId > b.variantId) return 1;
		return 0;
	});
}

function prefer<T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] {
	const matched = items.filter(keep);
	return matched.length > 0 ? matched : items;
}

function findAlias(
	title: string,
	aliases: readonly MatcherAlias[],
	corpus: MatcherCorpus,
): { readonly card: MatcherCard; readonly forcedVariant: MatcherVariant | null } | null {
	const byKey = new Map(corpus.cards.map((card) => [card.cardKey, card]));
	let best: { readonly phrase: string; readonly alias: MatcherAlias } | null = null;
	for (const alias of aliases) {
		if (!containsPhrase(title, alias.phrase)) continue;
		if (best === null || normalize(alias.phrase).length > normalize(best.phrase).length) {
			best = { phrase: alias.phrase, alias };
		}
	}
	if (best === null) return null;
	const card = byKey.get(best.alias.cardKey);
	if (card === undefined) return null;
	if (best.alias.variantId === null) return { card, forcedVariant: null };
	const variant = card.variants.find((entry) => entry.variantId === best.alias.variantId);
	if (variant === undefined) return { card, forcedVariant: null };
	return { card, forcedVariant: variant };
}

function cardsNamedIn(title: string, corpus: MatcherCorpus): MatcherCard[] {
	const names = uniqueSorted(corpus.cards.map((card) => card.name)).sort(
		(a, b) => normalize(b).length - normalize(a).length,
	);
	const hits: { readonly name: string; readonly start: number; readonly end: number }[] = [];
	const padded = ` ${normalize(title)} `;
	for (const name of names) {
		const needle = ` ${normalize(name)} `;
		if (needle.trim() === "") continue;
		let from = 0;
		while (from < padded.length) {
			const at = padded.indexOf(needle, from);
			if (at === -1) break;
			hits.push({ name, start: at, end: at + needle.length });
			from = at + 1;
		}
	}
	const kept = hits.filter(
		(hit) =>
			!hits.some(
				(other) =>
					other !== hit &&
					other.start <= hit.start &&
					other.end >= hit.end &&
					normalize(other.name).length > normalize(hit.name).length,
			),
	);
	const matchedNames = new Set(kept.map((hit) => hit.name));
	return corpus.cards.filter((card) => matchedNames.has(card.name));
}

function detectLotNames(title: string, corpus: MatcherCorpus): string[] {
	const names = uniqueSorted(corpus.cards.map((card) => card.name)).sort(
		(a, b) => normalize(b).length - normalize(a).length,
	);
	const hits: { readonly name: string; readonly start: number; readonly end: number }[] = [];
	const padded = ` ${normalize(title)} `;
	for (const name of names) {
		const needle = ` ${normalize(name)} `;
		if (needle.trim() === "") continue;
		const at = padded.indexOf(needle);
		if (at === -1) continue;
		hits.push({ name, start: at, end: at + needle.length });
	}
	const kept = hits.filter(
		(hit) =>
			!hits.some(
				(other) =>
					other !== hit &&
					other.start <= hit.start &&
					other.end >= hit.end &&
					normalize(other.name).length > normalize(hit.name).length,
			),
	);
	return uniqueSorted(kept.map((hit) => hit.name));
}

function extractLotKeywordNames(title: string, corpus: MatcherCorpus): string[] {
	return detectLotNames(title, corpus);
}

function setMentioned(title: string, card: MatcherCard): boolean {
	if (card.setName !== null && card.setName !== "" && containsPhrase(title, card.setName)) {
		return true;
	}
	if (
		card.setAbbreviation !== null &&
		card.setAbbreviation.length >= 2 &&
		containsPhrase(title, card.setAbbreviation)
	) {
		return true;
	}
	return containsPhrase(title, card.setId);
}

function numberMentioned(title: string, card: MatcherCard): boolean {
	const tokens = extractNumberTokens(title);
	const local = normalizeLocalId(card.localId);
	if (tokens.has(normalize(card.localId)) || tokens.has(local)) return true;
	if (containsPhrase(title, card.localId)) return true;
	return false;
}

function extractNumberTokens(title: string): Set<string> {
	const tokens = new Set<string>();
	const add = (raw: string) => {
		tokens.add(normalize(raw));
		tokens.add(normalizeLocalId(raw));
	};
	const slash = /\b(\d{1,4})\s*[/:]\s*\d{1,4}\b/g;
	const of = /\b(\d{1,4})\s+of\s+\d{1,4}\b/gi;
	const hash = /#\s*([A-Za-z]{0,6}\d{1,4}[A-Za-z]{0,4})/g;
	for (const match of title.matchAll(slash)) {
		if (match[1] !== undefined) add(match[1]);
	}
	for (const match of title.matchAll(of)) {
		if (match[1] !== undefined) add(match[1]);
	}
	for (const match of title.matchAll(hash)) {
		if (match[1] !== undefined) add(match[1]);
	}
	return tokens;
}

function normalizeLocalId(value: string): string {
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
	return normalize(trimmed);
}

interface PrintCues {
	readonly stamps: readonly string[];
	readonly subtype: string | null;
	readonly finish: string | null;
}

function parsePrintCues(title: string): PrintCues {
	const stamps: string[] = [];
	if (FIRST_EDITION.test(title)) {
		const stamp = canonicaliseAxisValue("stamp", "1st edition");
		if (stamp !== null) stamps.push(stamp);
	}

	let subtype: string | null = null;
	if (SHADOWLESS.test(title)) {
		const value = title.match(SHADOWLESS)?.[0];
		subtype = canonicaliseAxisValue("subtype", value ?? "shadowless");
	} else if (UNLIMITED.test(title)) {
		subtype = canonicaliseAxisValue("subtype", "unlimited");
	}

	let finish: string | null = null;
	if (REVERSE.test(title)) {
		finish = canonicaliseAxisValue("finish", "reverse");
	} else if (NON_HOLO.test(title)) {
		finish = canonicaliseAxisValue("finish", "normal");
	} else if (HOLO.test(title)) {
		finish = canonicaliseAxisValue("finish", "holo");
	}

	return { stamps, subtype, finish };
}

function filterVariants(variants: readonly MatcherVariant[], cues: PrintCues): MatcherVariant[] {
	return variants.filter((variant) => {
		if (cues.stamps.length > 0) {
			const has = cues.stamps.every((stamp) => variant.stamps.includes(stamp));
			if (!has) return false;
		}
		if (cues.subtype !== null) {
			if (variant.subtype === cues.subtype) {
				// exact
			} else if (
				cues.subtype === "unlimited" &&
				variant.subtype === null &&
				!variant.stamps.includes("1st-edition") &&
				(variant.finish === null || variant.finish === "normal")
			) {
				// Vintage titles say "unlimited" for the non-1st non-holo print even when
				// the row's subtype was left blank.
			} else {
				return false;
			}
		}
		if (cues.finish !== null && variant.finish !== null && variant.finish !== cues.finish) {
			return false;
		}
		return true;
	});
}

function detectLanguage(
	title: string,
	country: string | null,
): { readonly language: string; readonly source: LanguageSource } {
	if (/[\u3040-\u30ff]/.test(title)) {
		return { language: "ja", source: "marker" };
	}
	for (const marker of LANGUAGE_MARKERS) {
		if (marker.pattern.test(title)) return { language: marker.language, source: "marker" };
	}
	if (country !== null && country !== "") {
		const mapped = COUNTRY_LANGUAGE[country.toUpperCase()];
		if (mapped !== undefined) return { language: mapped, source: "country" };
	}
	return { language: "en", source: "default" };
}

function detectFilter(
	title: string,
	aspects: Readonly<Record<string, string>>,
): { readonly verdict: ListingResolution["filterVerdict"]; readonly reason: string | null } {
	for (const [name, value] of Object.entries(aspects)) {
		if (!/altered|custom\s*art/i.test(name)) continue;
		if (/^(no|none|unaltered|false|0)$/i.test(value.trim())) continue;
		return { verdict: "filtered", reason: `aspect ${name}=${value}` };
	}
	if (PROXY_TITLE.test(title)) {
		const match = title.match(PROXY_TITLE);
		return { verdict: "filtered", reason: `title contains "${match?.[0] ?? "proxy"}"` };
	}
	return { verdict: "pass", reason: null };
}

function parseGrade(title: string): {
	readonly grader: CopyGrader | null;
	readonly grade: number | null;
} {
	const match = GRADE_PHRASE.exec(title);
	if (match === null) return { grader: null, grade: null };
	const rawGrader = (match[1] ?? "").toUpperCase();
	const grader = COPY_GRADERS.find((entry) => entry === rawGrader);
	if (grader === undefined) return { grader: null, grade: null };
	const tenths = parseGradeTenths(match[2] ?? "");
	if (tenths === null) return { grader: null, grade: null };
	return { grader, grade: tenths };
}

function stripGrade(title: string): string {
	return title.replace(GRADE_PHRASE, " ");
}

function scoreNone(opts: {
	readonly isLot: boolean;
	readonly languageSource: LanguageSource;
}): number {
	if (opts.isLot) return opts.languageSource === "default" ? 1 - LANGUAGE_DEFAULT_PENALTY : 1;
	return 0;
}

function scoreMatch(
	opts: Evidence & { readonly languageSource: LanguageSource; readonly grain: "card" | "variant" },
): number {
	let confidence = 0.7;
	if (opts.matchedSet && opts.matchedNumber) confidence = 0.92;
	else if (opts.matchedNumber) confidence = 0.88;
	else if (opts.matchedSet) confidence = 0.84;
	if (opts.grain === "variant" && opts.narrowedVariant) confidence += 0.03;
	if (opts.languageSource === "default") confidence -= LANGUAGE_DEFAULT_PENALTY;
	return confidence;
}

function clampConfidence(value: number): number {
	const clamped = Math.min(1, Math.max(0, value));
	return Math.round(clamped * 10_000) / 10_000;
}

export function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/[δΔ]/g, "delta")
		.replace(/['’]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
	const needle = normalize(phrase);
	if (needle === "") return false;
	return ` ${normalize(haystack)} `.includes(` ${needle} `);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Exposed so stamp hyphenation can be asserted against the same slug the ingest uses. */
export function stampSlug(raw: string): string {
	return slugifyAxisValue(raw);
}
