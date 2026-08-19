import type { MatcherCard, MatcherCorpus, MatcherVariant } from "../../shared/matcher.ts";

/**
 * A closed corpus shaped around the cases the matcher is required to get right.
 *
 * Distinct from the binder fixture: this one holds four printings of Jungle Gloom so
 * card-grain is observable, a colliding `variant_id` on a different card, Japanese
 * kana/kanji, a trainer-owned card, a mechanic variant, and a second species so lots
 * can be flagged by multiple names.
 */

export const SHARED_VARIANT_ID = "endfynwn4n10gzq";
export const FIRST_EDITION_VARIANT_ID = "2fnyg4g532wu2uft0spaa3eefrz";
export const JUNGLE_HOLO_VARIANT_ID = "jungle-gloom-holo";
export const JUNGLE_REVERSE_VARIANT_ID = "jungle-gloom-reverse";
export const ERIKA_FIRST_EDITION_VARIANT_ID = "erika-1st";
export const ERIKA_UNLIMITED_VARIANT_ID = "erika-unl";

function variant(partial: MatcherVariant): MatcherVariant {
	return {
		variantId: partial.variantId,
		finish: partial.finish,
		subtype: partial.subtype,
		stamps: [...partial.stamps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
		foil: partial.foil,
		size: partial.size,
	};
}

function card(
	partial: Omit<MatcherCard, "variants"> & { readonly variants: readonly MatcherVariant[] },
): MatcherCard {
	return {
		...partial,
		variants: [...partial.variants].sort((a, b) =>
			a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
		),
	};
}

export const MATCHER_CORPUS: MatcherCorpus = {
	cards: [
		card({
			cardKey: "en:base2-44",
			language: "en",
			cardId: "base2-44",
			setId: "base2",
			setName: "Jungle",
			setAbbreviation: "JU",
			localId: "44",
			name: "Gloom",
			variants: [
				variant({
					variantId: SHARED_VARIANT_ID,
					finish: "normal",
					subtype: "unlimited",
					stamps: [],
					foil: null,
					size: "standard",
				}),
				variant({
					variantId: FIRST_EDITION_VARIANT_ID,
					finish: "normal",
					subtype: null,
					stamps: ["1st-edition"],
					foil: null,
					size: "standard",
				}),
				variant({
					variantId: JUNGLE_HOLO_VARIANT_ID,
					finish: "holo",
					subtype: null,
					stamps: [],
					foil: null,
					size: "standard",
				}),
				variant({
					variantId: JUNGLE_REVERSE_VARIANT_ID,
					finish: "reverse",
					subtype: null,
					stamps: [],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "en:base1-45",
			language: "en",
			cardId: "base1-45",
			setId: "base1",
			setName: "Base Set",
			setAbbreviation: "BS",
			localId: "45",
			name: "Vileplume",
			variants: [
				variant({
					variantId: SHARED_VARIANT_ID,
					finish: "holo",
					subtype: "shadowless",
					stamps: [],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "en:base2-58",
			language: "en",
			cardId: "base2-58",
			setId: "base2",
			setName: "Jungle",
			setAbbreviation: "JU",
			localId: "58",
			name: "Oddish",
			variants: [
				variant({
					variantId: "oddish-unl",
					finish: "normal",
					subtype: "unlimited",
					stamps: [],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "en:gym1-45",
			language: "en",
			cardId: "gym1-45",
			setId: "gym1",
			setName: "Gym Heroes",
			setAbbreviation: null,
			localId: "45",
			name: "Erika's Gloom",
			variants: [
				variant({
					variantId: ERIKA_UNLIMITED_VARIANT_ID,
					finish: "normal",
					subtype: "unlimited",
					stamps: [],
					foil: null,
					size: "standard",
				}),
				variant({
					variantId: ERIKA_FIRST_EDITION_VARIANT_ID,
					finish: "normal",
					subtype: null,
					stamps: ["1st-edition"],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "en:base5-36",
			language: "en",
			cardId: "base5-36",
			setId: "base5",
			setName: "Team Rocket",
			setAbbreviation: "TR",
			localId: "36",
			name: "Dark Gloom",
			variants: [
				variant({
					variantId: "dark-gloom",
					finish: "normal",
					subtype: "unlimited",
					stamps: [],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "en:ex13-42",
			language: "en",
			cardId: "ex13-42",
			setId: "ex13",
			setName: "Holon Phantoms",
			setAbbreviation: null,
			localId: "42",
			name: "Gloom δ",
			variants: [
				variant({
					variantId: "gloom-delta",
					finish: "normal",
					subtype: null,
					stamps: [],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "ja:SV3-002",
			language: "ja",
			cardId: "SV3-002",
			setId: "SV3",
			setName: "黒炎の支配者",
			setAbbreviation: null,
			localId: "002",
			name: "クサイハナ",
			variants: [
				variant({
					variantId: "generated",
					finish: "holo",
					subtype: null,
					stamps: ["1st-edition"],
					foil: null,
					size: "standard",
				}),
			],
		}),
		card({
			cardKey: "fr:base2-44",
			language: "fr",
			cardId: "base2-44",
			setId: "base2",
			setName: "Jungle",
			setAbbreviation: null,
			localId: "44",
			name: "Ortide",
			variants: [
				variant({
					variantId: SHARED_VARIANT_ID,
					finish: "holo",
					subtype: null,
					stamps: ["1st-edition"],
					foil: "pokeball",
					size: "standard",
				}),
			],
		}),
	].sort((a, b) => (a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0)),
};
