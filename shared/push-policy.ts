/**
 * The judgement layer: whether a resolved listing earns an instant push, a digest slot, or
 * silence — and, when it is instant, what the notification says.
 *
 * Pure. Ownership, priorities and the match arrive as values; this module never opens the
 * database. There is no price gate: an absolute ceiling cannot tell a deal from a rip-off, and
 * one number is meaningless across a line that spans a couple of dollars to several hundred.
 *
 * Card-grain needed-ness is the spec's three-way, not a boolean: owns none qualifies, owns all
 * is suppressed, owns some waits for the confirm queue and never notifies. Guessing a printing
 * the title did not name is the silent error the precision bias exists to prevent.
 */

import { binderEntryKey } from "./contract.ts";
import { DEFAULT_PRIORITY_INSTANT_LEVEL } from "./copies.ts";
import type { ListingDocument } from "./listings.ts";
import { listingFeedPath } from "./listings.ts";
import type { ListingResolution, MatcherCard, VariantCandidate } from "./matcher.ts";
import { DEFAULT_MATCH_CONFIDENCE_THRESHOLD } from "./matcher.ts";
import { formatMoney } from "./money.ts";
import type { PushNotificationContent } from "./push.ts";
import { resolveNavigateTarget } from "./push.ts";

export type PushDisposition = "instant" | "digest" | "nothing";

export interface PushPolicyConfig {
	readonly confidenceThreshold: number;
	readonly instantPriorityLevel: number;
}

export const DEFAULT_PUSH_POLICY: PushPolicyConfig = {
	confidenceThreshold: DEFAULT_MATCH_CONFIDENCE_THRESHOLD,
	instantPriorityLevel: DEFAULT_PRIORITY_INSTANT_LEVEL,
};

export interface PushPolicyInput {
	readonly match: ListingResolution;
	/** `binderEntryKey` values the owner currently holds. Absent means none. */
	readonly owned: ReadonlySet<string>;
	/** `binderEntryKey` → 0–3. Absent means unset, which is below every instant bar. */
	readonly priorities: ReadonlyMap<string, number>;
}

interface MatchVariant {
	readonly cardKey: string;
	readonly variantId: string;
}

function relevantVariants(match: ListingResolution): readonly MatchVariant[] {
	if (match.grain === "variant" && match.cardKey !== null && match.variantId !== null) {
		return [{ cardKey: match.cardKey, variantId: match.variantId }];
	}
	if (match.grain === "card" && match.candidates !== null) {
		return match.candidates.map((candidate: VariantCandidate) => ({
			cardKey: candidate.cardKey,
			variantId: candidate.variantId,
		}));
	}
	return [];
}

/**
 * Instant, digest, or nothing. Digest sending is a later ticket; the disposition is still
 * returned so a low-priority needed card is distinguishable from a suppressed one.
 */
export function decidePushDisposition(
	input: PushPolicyInput,
	config: PushPolicyConfig = DEFAULT_PUSH_POLICY,
): PushDisposition {
	const { match } = input;
	if (match.isLot) return "nothing";
	if (match.filterVerdict === "filtered") return "nothing";
	if (match.grain === "none") return "nothing";
	if (match.confidence < config.confidenceThreshold) return "nothing";

	const variants = relevantVariants(match);
	if (variants.length === 0) return "nothing";

	const ownedCount = variants.filter((variant) =>
		input.owned.has(binderEntryKey(variant.cardKey, variant.variantId)),
	).length;

	if (match.grain === "variant") {
		if (ownedCount > 0) return "nothing";
	} else if (ownedCount > 0) {
		// Owns some or owns all: the title did not name a printing, so this is homework, not a
		// notification. Owns-none is the only card-grain case that qualifies.
		return "nothing";
	}

	let highest = Number.NEGATIVE_INFINITY;
	for (const variant of variants) {
		const priority = input.priorities.get(binderEntryKey(variant.cardKey, variant.variantId));
		if (priority !== undefined && priority > highest) highest = priority;
	}
	if (highest >= config.instantPriorityLevel) return "instant";
	return "digest";
}

/**
 * The structured facts an instant notification is allowed to speak. Built from the match and
 * the corpus, never from the listing title — titles carry condition grades ("NM", "Very Good")
 * that the spec forbids putting on a notification.
 */
export interface InstantPushSubject {
	readonly itemId: string;
	readonly cardName: string;
	readonly setName: string | null;
	readonly language: string;
	readonly finish: string | null;
	readonly priceMinor: number | null;
	readonly currency: string | null;
	readonly graded: boolean;
	readonly buyingOption: string | null;
}

function sharedFinish(candidates: readonly VariantCandidate[], card: MatcherCard): string | null {
	const finishes = candidates.map((candidate) => {
		const variant = card.variants.find((entry) => entry.variantId === candidate.variantId);
		return variant?.finish ?? candidate.finish;
	});
	const first = finishes[0] ?? null;
	return finishes.every((finish) => finish === first) ? first : null;
}

export function instantPushSubject(
	listing: ListingDocument,
	card: MatcherCard | null,
): InstantPushSubject | null {
	if (card === null) return null;
	const match = listing.match;
	if (match.grain === "none" || match.cardKey === null) return null;

	let finish: string | null = null;
	if (match.grain === "variant" && match.variantId !== null) {
		finish = card.variants.find((entry) => entry.variantId === match.variantId)?.finish ?? null;
	} else if (match.candidates !== null && match.candidates.length > 0) {
		finish = sharedFinish(match.candidates, card);
	}

	return {
		itemId: listing.itemId,
		cardName: card.name,
		setName: card.setName,
		language: match.language,
		finish,
		priceMinor: listing.priceMinor,
		currency: listing.currency,
		graded: match.parsedGrader !== null,
		buyingOption: listing.buyingOption,
	};
}

function languageLabel(language: string): string {
	const primary = language.split("-")[0] ?? language;
	return primary.toUpperCase();
}

function formatBuyingOption(buyingOption: string | null): string {
	if (buyingOption === null || buyingOption === "") return "listing";
	if (buyingOption === "AUCTION") return "auction";
	if (buyingOption === "FIXED_PRICE") return "buy it now";
	if (buyingOption === "BEST_OFFER") return "best offer";
	return buyingOption.toLowerCase().replaceAll("_", " ");
}

/**
 * Self-sufficient copy: card, set, language, finish when known, price with currency,
 * graded/ungraded, format. No condition grade, no image, no action buttons — those are not
 * fields of `PushNotificationContent`, and must not be added here.
 */
export function buildInstantPushContent(
	subject: InstantPushSubject,
	origin: string,
): PushNotificationContent {
	const identity = [subject.setName, languageLabel(subject.language), subject.finish].filter(
		(part): part is string => part !== null && part !== "",
	);
	const title =
		identity.length === 0 ? subject.cardName : `${subject.cardName} – ${identity.join(" ")}`;

	const body: string[] = [];
	if (subject.priceMinor !== null && subject.currency !== null) {
		body.push(formatMoney(subject.priceMinor, subject.currency));
	}
	body.push(subject.graded ? "graded" : "ungraded");
	body.push(formatBuyingOption(subject.buyingOption));

	return {
		title,
		body: body.join(" – "),
		navigate: resolveNavigateTarget(origin, listingFeedPath(subject.itemId)),
		lang: subject.language,
	};
}
