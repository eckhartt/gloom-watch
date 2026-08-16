/**
 * Who belongs in the masterset.
 *
 * The whole point of this module is that it is a **pure function over records already fetched**.
 * Phase 1 pulls the brief list per language and stores it; every boundary rule below then runs
 * locally against that store, so re-scoping the line costs a re-filter and a detail fetch for
 * the newly-included cards rather than a fresh crawl.
 *
 * One rule cannot be local, and it is worth saying why rather than hiding it: the brief form
 * `/v2/{lang}/cards` returns `{id, localId, name, image}` and **no `dexId`**. Membership by dex
 * number therefore needs upstream's help — one narrow request per species per language, whose
 * *result* is stored alongside the brief list and filtered locally thereafter. The alternative
 * is a detail fetch for all 138,909 brief records to obtain a field, which is not a trade worth
 * making. See `docs/corpus.md`.
 */

/** Oddish, Gloom, Vileplume, Bellossom. */
export const ODDISH_LINE_DEX_IDS: readonly number[] = [43, 44, 45, 182];

export const ODDISH_LINE_SPECIES: readonly string[] = ["oddish", "gloom", "vileplume", "bellossom"];

/**
 * TCG Pocket is digital-only and permanently uncollectable, so it must leave the masterset
 * before anything is counted.
 *
 * **By prefix, never by equality.** 15 of TCGdex's 218 sets are TCG Pocket and there is no flag
 * marking them; suffixed IDs like `A2b`, `A3b`, `A4a`, `B1a` and `B2a` mean an exact-match list
 * misses a third of them. Verified against the live `tcgp` series membership: this pattern
 * matches all 15 and nothing else in the other 203.
 */
export const TCG_POCKET_SET_PREFIX = /^(?:A\d|B\d|P-A)/;

export function isTcgPocketSetId(setId: string): boolean {
	return TCG_POCKET_SET_PREFIX.test(setId);
}

/**
 * TCGdex card IDs are `{setId}-{localId}`, and the set is the part before the last hyphen —
 * except that set IDs themselves contain hyphens (`tk-ex-m`, `P-A`) and local IDs do not always
 * look numeric (`SH3`, `XY99`, `H31`). Phase 1 only has the brief form, which carries `localId`
 * but not the set, so the set ID is what remains once the local ID and its hyphen are removed.
 */
export function setIdFromCardId(cardId: string, localId: string): string {
	const suffix = `-${localId}`;
	return cardId.endsWith(suffix) ? cardId.slice(0, -suffix.length) : cardId;
}

export type MembershipReason = "dex" | "name" | "both";

export interface MembershipCandidate {
	readonly language: string;
	readonly cardId: string;
	readonly localId: string;
	readonly name: string;
	readonly setId: string;
	readonly reason: MembershipReason;
}

export interface BriefRecord {
	readonly language: string;
	readonly cardId: string;
	readonly localId: string;
	readonly name: string;
	/** The dex IDs, from the per-species index. Empty when the card matched on name alone. */
	readonly dexIds: readonly number[];
}

export interface MembershipOptions {
	readonly dexIds?: readonly number[];
	readonly species?: readonly string[];
	/** Card keys (`{language}:{cardId}`) the owner has excluded by hand. */
	readonly excluded?: ReadonlySet<string>;
}

export function cardKeyFor(language: string, cardId: string): string {
	return `${language}:${cardId}`;
}

/**
 * `dexId ∈ {43,44,45,182}` **unioned with** a name-contains sweep, minus TCG Pocket, minus the
 * exclusions table.
 *
 * Both halves of the union are load-bearing, and the live corpus proves each of them:
 *
 * - **Name only, 3 cards in English**: `me02.5-001` Erika's Oddish, `me02.5-002` Erika's Gloom
 *   and `me02.5-003` Erika's Vileplume ex carry no `dexId` at all. The dex sweep misses them.
 * - **Dex only, 266 cards**: every French `Mystherbe`, German `Myrapla`, Japanese `ナゾノクサ`,
 *   Traditional Chinese `走路草` and Thai `นาโซโนะคุสะ`. The name sweep misses all of them,
 *   because the species names it sweeps for are English.
 */
export function selectMembers(
	records: readonly BriefRecord[],
	options: MembershipOptions = {},
): MembershipCandidate[] {
	const dexIds = new Set(options.dexIds ?? ODDISH_LINE_DEX_IDS);
	const species = (options.species ?? ODDISH_LINE_SPECIES).map((name) => name.toLowerCase());
	const excluded = options.excluded ?? new Set<string>();

	const members: MembershipCandidate[] = [];
	for (const record of records) {
		const byDex = record.dexIds.some((dexId) => dexIds.has(dexId));
		const haystack = record.name.toLowerCase();
		const byName = species.some((name) => haystack.includes(name));
		if (!byDex && !byName) continue;

		const setId = setIdFromCardId(record.cardId, record.localId);
		if (isTcgPocketSetId(setId)) continue;
		if (excluded.has(cardKeyFor(record.language, record.cardId))) continue;

		members.push({
			language: record.language,
			cardId: record.cardId,
			localId: record.localId,
			name: record.name,
			setId,
			reason: byDex && byName ? "both" : byDex ? "dex" : "name",
		});
	}
	return members;
}
