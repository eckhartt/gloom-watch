import type { TcgdexCardDetail } from "../../server/corpus/tcgdex.ts";
import type { FakeCorpus } from "./fake-tcgdex.ts";
import { webpBytes } from "./fake-tcgdex.ts";

/**
 * A miniature TCGdex holding the awkward cases in the real one:
 *
 * - the same set and number in two languages (`en:base2-44` and `fr:base2-44`)
 * - one `variant_id` shared across two different cards
 * - a `variant_id` of the literal string `generated`
 * - `1st edition` and `1st-edition` in the same corpus
 * - localised axis values (`Olografica`, `1re Édition`)
 * - a TCG Pocket card with a suffixed set ID
 * - a card with a `dexId` and no English name, and one with an English name and no `dexId`
 * - a card upstream has no image for
 */
export const SHARED_VARIANT_ID = "endfynwn4n10gzq";

function detail(partial: TcgdexCardDetail): TcgdexCardDetail {
	return partial;
}

export function buildFakeCorpus(): FakeCorpus {
	const images: Record<string, Uint8Array> = {
		"https://assets.tcgdex.net/en/base/base2/44/high.webp": webpBytes(1),
		"https://assets.tcgdex.net/en/base/base1/45/high.webp": webpBytes(2),
		"https://assets.tcgdex.net/fr/base/base2/44/high.webp": webpBytes(3),
		"https://assets.tcgdex.net/ja/sv/SV3/002/high.webp": webpBytes(4),
	};

	return {
		languages: ["en", "fr", "ja", "nl"],
		cards: {
			en: [
				{
					id: "base2-44",
					localId: "44",
					name: "Gloom",
					image: "https://assets.tcgdex.net/en/base/base2/44",
				},
				{
					id: "base1-45",
					localId: "45",
					name: "Vileplume",
					image: "https://assets.tcgdex.net/en/base/base1/45",
				},
				// Name sweep only: no dexId upstream.
				{ id: "me02.5-002", localId: "002", name: "Erika's Gloom" },
				// TCG Pocket, suffixed set ID.
				{ id: "A2b-002", localId: "002", name: "Gloom" },
				// Nothing to do with the line.
				{
					id: "base1-4",
					localId: "4",
					name: "Charizard",
					image: "https://assets.tcgdex.net/en/base/base1/4",
				},
			],
			fr: [
				{
					id: "base2-44",
					localId: "44",
					name: "Ortide",
					image: "https://assets.tcgdex.net/fr/base/base2/44",
				},
			],
			ja: [
				{
					id: "SV3-002",
					localId: "002",
					name: "クサイハナ",
					image: "https://assets.tcgdex.net/ja/sv/SV3/002",
				},
			],
			nl: [],
		},
		dexIds: {
			en: { "base2-44": [44], "base1-45": [45], "A2b-002": [44], "base1-4": [6] },
			fr: { "base2-44": [44] },
			ja: { "SV3-002": [44] },
			nl: {},
		},
		details: {
			"en|base2-44": detail({
				id: "base2-44",
				localId: "44",
				name: "Gloom",
				image: "https://assets.tcgdex.net/en/base/base2/44",
				category: "Pokemon",
				rarity: "Uncommon",
				dexId: [44],
				set: { id: "base2", name: "Jungle" },
				variants: { firstEdition: true, holo: false, normal: true, reverse: false, wPromo: false },
				variants_detailed: [
					{ type: "normal", size: "standard", variantId: SHARED_VARIANT_ID },
					{
						type: "normal",
						size: "standard",
						stamp: ["1st-edition"],
						variantId: "2fnyg4g532wu2uft0spaa3eefrz",
					},
				],
			}),
			"en|base1-45": detail({
				id: "base1-45",
				localId: "45",
				name: "Vileplume",
				image: "https://assets.tcgdex.net/en/base/base1/45",
				dexId: [45],
				set: { id: "base1", name: "Base Set" },
				variants_detailed: [
					// The same variant_id as the Jungle Gloom above.
					{ type: "holo", size: "standard", variantId: SHARED_VARIANT_ID },
				],
			}),
			"en|me02.5-002": detail({
				id: "me02.5-002",
				localId: "002",
				name: "Erika's Gloom",
				set: { id: "me02.5", name: "Mega Evolution promos" },
				variants_detailed: [{ type: "normal", variantId: "generated" }],
			}),
			"fr|base2-44": detail({
				id: "base2-44",
				localId: "44",
				name: "Ortide",
				image: "https://assets.tcgdex.net/fr/base/base2/44",
				dexId: [44],
				set: { id: "base2", name: "Jungle" },
				variants_detailed: [
					{
						type: "Olografica",
						size: "Standard",
						stamp: ["1re Édition"],
						foil: "Poké Ball",
						variantId: SHARED_VARIANT_ID,
					},
				],
			}),
			"ja|SV3-002": detail({
				id: "SV3-002",
				localId: "002",
				name: "クサイハナ",
				image: "https://assets.tcgdex.net/ja/sv/SV3/002",
				dexId: [44],
				set: { id: "SV3", name: "黒炎の支配者" },
				variants_detailed: [
					{ type: "holo", size: "standard", stamp: ["1st edition"], variantId: "generated" },
				],
			}),
		},
		manifest: {
			en: { base: { base2: { "44": "hash-en-base2-44" }, base1: { "45": "hash-en-base1-45" } } },
			fr: { base: { base2: { "44": "hash-fr-base2-44" } } },
			ja: { sv: { SV3: { "002": "hash-ja-sv3-002" } } },
		},
		manifestEtag: '"manifest-v1"',
		images,
	};
}
