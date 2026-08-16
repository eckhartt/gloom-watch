import type { GloomDatabase } from "../../server/db/client.ts";
import { corpusCards, corpusSets, corpusVariants } from "../../server/db/schema.ts";
import { webpBytes } from "./fake-tcgdex.ts";

/**
 * A corpus written straight into the tables, shaped around the cases the binder can get wrong.
 *
 * Written directly rather than driven through a sync, because a sync can only produce what
 * TCGdex would produce and two of these cases are things the *database* can hold: a set with no
 * row at all, and a card flagged `missing_upstream`. The sync's own behaviour is covered by
 * `tests/corpus-sync.test.ts` and `tests/corpus-sets.test.ts`.
 *
 * What is in here and why:
 *
 * - **one `variant_id` on two different cards** — the collapse that a key of `variant_id` alone
 *   causes, and the reason identity is composite
 * - **two variants on one card** — the tie the ordering has to break deterministically
 * - **a set with no release date** and **a card whose set has no row at all** — the two ways an
 *   entry can arrive undated, both of which must sort last rather than first
 * - **the same expansion in two languages** is not here but its consequence is: every set key
 *   carries its language
 * - **`8` and `SV3` in one set** — Shining Fates really does number cards both ways, and a naive
 *   numeric or lexical sort gets one of them wrong
 * - **a card with no image**, since 115 of the live corpus's 497 have none
 * - **a card flagged `missing_upstream`**, which stays in the binder rather than vanishing
 */

/** The `variant_id` shared by the Jungle Gloom and the Base Set Vileplume. */
export const SHARED_VARIANT = "endfynwn4n10gzq";
/** The other printing of the Jungle Gloom. Sorts before the shared one, `2` before `e`. */
export const FIRST_EDITION_VARIANT = "2fnyg4g532wu2uft0spaa3eefrz";

const SEEDED_AT = 1_700_000_000_000;

interface SeedCard {
	readonly cardKey: string;
	readonly language: string;
	readonly cardId: string;
	readonly setId: string;
	readonly setName: string;
	readonly localId: string;
	readonly name: string;
	readonly rarity?: string;
	readonly withImage?: boolean;
	readonly missingUpstream?: boolean;
	readonly variants: readonly SeedVariant[];
}

interface SeedVariant {
	readonly variantId: string;
	readonly finish?: string;
	readonly subtype?: string;
	readonly stamps?: readonly string[];
	readonly foil?: string;
	readonly size?: string;
}

const SETS = [
	{
		setKey: "ja:SV3",
		language: "ja",
		setId: "SV3",
		name: "黒炎の支配者",
		releaseDate: "2023-07-28",
	},
	{
		setKey: "en:swsh45",
		language: "en",
		setId: "swsh45",
		name: "Shining Fates",
		releaseDate: "2021-02-19",
	},
	{ setKey: "en:base2", language: "en", setId: "base2", name: "Jungle", releaseDate: "1999-06-16" },
	{
		setKey: "en:base1",
		language: "en",
		setId: "base1",
		name: "Base Set",
		releaseDate: "1999-01-09",
	},
	// Upstream knows this set and carries no date for it.
	{
		setKey: "en:me02.5",
		language: "en",
		setId: "me02.5",
		name: "Mega Evolution promos",
		releaseDate: null,
	},
	// `en:swshp` is deliberately absent: a card can reference a set the sets phase has not
	// reached yet, and the binder must render it rather than drop it or throw.
] as const;

const CARDS: readonly SeedCard[] = [
	{
		cardKey: "ja:SV3-002",
		language: "ja",
		cardId: "SV3-002",
		setId: "SV3",
		setName: "黒炎の支配者",
		localId: "002",
		name: "クサイハナ",
		rarity: "U",
		withImage: true,
		variants: [{ variantId: "generated", finish: "holo", stamps: ["1st-edition"] }],
	},
	{
		cardKey: "en:swsh45-8",
		language: "en",
		cardId: "swsh45-8",
		setId: "swsh45",
		setName: "Shining Fates",
		localId: "8",
		name: "Gloom",
		withImage: true,
		variants: [{ variantId: "generated", finish: "reverse", size: "standard" }],
	},
	{
		cardKey: "en:swsh45-SV3",
		language: "en",
		cardId: "swsh45-SV3",
		setId: "swsh45",
		setName: "Shining Fates",
		localId: "SV3",
		name: "Gloom",
		rarity: "Shiny rare",
		withImage: true,
		variants: [{ variantId: "shinyvault", finish: "holo", foil: "cracked-ice" }],
	},
	{
		cardKey: "en:base2-44",
		language: "en",
		cardId: "base2-44",
		setId: "base2",
		setName: "Jungle",
		localId: "44",
		name: "Gloom",
		rarity: "Uncommon",
		withImage: true,
		variants: [
			{ variantId: SHARED_VARIANT, finish: "normal", size: "standard" },
			{
				variantId: FIRST_EDITION_VARIANT,
				finish: "normal",
				stamps: ["1st-edition"],
				size: "standard",
			},
		],
	},
	{
		cardKey: "en:base1-45",
		language: "en",
		cardId: "base1-45",
		setId: "base1",
		setName: "Base Set",
		localId: "45",
		name: "Vileplume",
		withImage: true,
		// The same `variant_id` as the Jungle Gloom above, on a different card.
		variants: [{ variantId: SHARED_VARIANT, finish: "holo", subtype: "shadowless" }],
	},
	{
		cardKey: "en:me02.5-002",
		language: "en",
		cardId: "me02.5-002",
		setId: "me02.5",
		setName: "Mega Evolution promos",
		localId: "002",
		name: "Erika's Gloom",
		missingUpstream: true,
		variants: [{ variantId: "generated", finish: "normal" }],
	},
	{
		cardKey: "en:swshp-SWSH040",
		language: "en",
		cardId: "swshp-SWSH040",
		setId: "swshp",
		setName: "SWSH Black Star Promos",
		localId: "SWSH040",
		name: "Gloom",
		variants: [{ variantId: "promo", finish: "holo" }],
	},
];

export function seedBinderCorpus(db: GloomDatabase): void {
	for (const set of SETS) {
		db.insert(corpusSets)
			.values({
				setKey: set.setKey,
				language: set.language,
				setId: set.setId,
				name: set.name,
				releaseDate: set.releaseDate,
				provenance: "tcgdex",
				firstSeenAt: SEEDED_AT,
				lastSyncedAt: SEEDED_AT,
			})
			.run();
	}

	let imageSeed = 1;
	for (const card of CARDS) {
		const bytes = card.withImage === true ? webpBytes(imageSeed++) : null;
		db.insert(corpusCards)
			.values({
				cardKey: card.cardKey,
				language: card.language,
				cardId: card.cardId,
				setId: card.setId,
				setName: card.setName,
				localId: card.localId,
				name: card.name,
				rarity: card.rarity ?? null,
				membershipReason: "dex",
				imageBytes: bytes === null ? null : Buffer.from(bytes),
				imageByteSize: bytes?.byteLength ?? null,
				imageContentType: bytes === null ? null : "image/webp",
				imageHash: bytes === null ? null : `hash-${card.cardKey}`,
				provenance: "tcgdex",
				missingUpstream: card.missingUpstream === true ? 1 : 0,
				firstSeenAt: SEEDED_AT,
				lastSyncedAt: SEEDED_AT,
			})
			.run();

		for (const variant of card.variants) {
			db.insert(corpusVariants)
				.values({
					cardKey: card.cardKey,
					variantId: variant.variantId,
					finish: variant.finish ?? null,
					subtype: variant.subtype ?? null,
					stamps: JSON.stringify(variant.stamps ?? []),
					foil: variant.foil ?? null,
					size: variant.size ?? null,
					provenance: "tcgdex",
					firstSeenAt: SEEDED_AT,
					lastSyncedAt: SEEDED_AT,
				})
				.run();
		}
	}
}

/** Every entry key the fixture produces, in the order the binder must return them. */
export const EXPECTED_ORDER: readonly string[] = [
	"ja:SV3-002 generated",
	"en:swsh45-8 generated",
	"en:swsh45-SV3 shinyvault",
	`en:base2-44 ${FIRST_EDITION_VARIANT}`,
	`en:base2-44 ${SHARED_VARIANT}`,
	`en:base1-45 ${SHARED_VARIANT}`,
	"en:me02.5-002 generated",
	"en:swshp-SWSH040 promo",
];
