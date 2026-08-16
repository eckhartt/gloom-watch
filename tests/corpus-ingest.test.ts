import { describe, expect, it } from "vitest";
import { normaliseCard } from "../server/corpus/ingest.ts";
import type { TcgdexCardDetail } from "../server/corpus/tcgdex.ts";

/**
 * `(TCGdex records) → rows`, with no database and no network. The fixtures below are trimmed
 * live responses; the variant IDs, stamps and the `variants`/`variants_detailed` disagreement
 * are real.
 */

const JUNGLE_GLOOM_EN: TcgdexCardDetail = {
	id: "base2-44",
	localId: "44",
	name: "Gloom",
	image: "https://assets.tcgdex.net/en/base/base2/44",
	category: "Pokemon",
	rarity: "Uncommon",
	dexId: [44],
	set: { id: "base2", name: "Jungle" },
	// The legacy flat object. It reports one printing where `variants_detailed` enumerates two.
	variants: { firstEdition: true, holo: false, normal: true, reverse: false, wPromo: false },
	variants_detailed: [
		{ type: "normal", size: "standard", variantId: "endfynwn4n10gzq" },
		{
			type: "normal",
			size: "standard",
			stamp: ["1st-edition"],
			variantId: "2fnyg4g532wu2uft0spaa3eefrz",
		},
	],
};

describe("card identity", () => {
	it("includes the language, so the same set and number in two languages are two rows", () => {
		// TCGdex serves the same western set IDs across en/fr/de/it/es/pt. A key of
		// `{setId}-{localId}` alone silently overwrites five languages on the sixth ingest pass.
		const en = normaliseCard("en", JUNGLE_GLOOM_EN, "both").card;
		const fr = normaliseCard("fr", { ...JUNGLE_GLOOM_EN, name: "Ortide" }, "dex").card;

		expect(en?.cardKey).toBe("en:base2-44");
		expect(fr?.cardKey).toBe("fr:base2-44");
		expect(en?.cardKey).not.toBe(fr?.cardKey);
		expect(en?.language).toBe("en");
		expect(fr?.language).toBe("fr");
	});
});

describe("variant identity", () => {
	it("is (card, variant_id): two cards sharing one variant_id produce two rows", () => {
		// In the live corpus 818 variants carry only 21 distinct variant_ids, and the most-shared
		// is held by 264 different cards. Keyed on variant_id alone the masterset collapses to 21
		// rows.
		const shared = "endfynwn4n10gzq";
		const a = normaliseCard("en", JUNGLE_GLOOM_EN, "both").card;
		const b = normaliseCard(
			"en",
			{ ...JUNGLE_GLOOM_EN, id: "base1-45", localId: "45", name: "Vileplume" },
			"both",
		).card;

		const keys = [
			...(a?.variants ?? []).map((v) => `${v.cardKey}|${v.variantId}`),
			...(b?.variants ?? []).map((v) => `${v.cardKey}|${v.variantId}`),
		];
		expect(a?.variants.some((v) => v.variantId === shared)).toBe(true);
		expect(b?.variants.some((v) => v.variantId === shared)).toBe(true);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain(`en:base2-44|${shared}`);
		expect(keys).toContain(`en:base1-45|${shared}`);
	});

	it("treats the literal string `generated` as an opaque token", () => {
		// Real data: 106 cards in the line carry a variant_id of exactly `generated`. It is not
		// hash-shaped, it is not a placeholder, and it is never parsed.
		const card = normaliseCard(
			"ja",
			{
				...JUNGLE_GLOOM_EN,
				id: "SV3-002",
				set: { id: "SV3", name: "黒炎の支配者" },
				variants_detailed: [{ type: "holo", size: "standard", variantId: "generated" }],
			},
			"dex",
		).card;

		expect(card?.variants).toHaveLength(1);
		expect(card?.variants[0]?.variantId).toBe("generated");
		expect(card?.variants[0]?.finish).toBe("holo");
	});

	it("collapses a repeated variant_id within one card to a single row", () => {
		const card = normaliseCard(
			"en",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [
					{ type: "normal", variantId: "abc" },
					{ type: "normal", variantId: "abc" },
				],
			},
			"both",
		).card;
		expect(card?.variants).toHaveLength(1);
	});

	it("drops a variant with no id rather than inventing one", () => {
		const card = normaliseCard(
			"en",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [{ type: "normal" } as never, { type: "holo", variantId: "real" }],
			},
			"both",
		).card;
		expect(card?.variants.map((v) => v.variantId)).toEqual(["real"]);
	});
});

describe("the five axes", () => {
	it("stores all five, canonicalised, with stamps as a sorted list", () => {
		const card = normaliseCard(
			"it",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [
					{
						type: "Olografica",
						subtype: "unlimited",
						stamp: ["Set-Logo", "1st edition"],
						foil: "Poké Ball",
						size: "Standard",
						variantId: "v1",
					},
				],
			},
			"dex",
		).card;

		const variant = card?.variants[0];
		expect(variant?.finish).toBe("holo");
		expect(variant?.subtype).toBe("unlimited");
		expect(variant?.stamps).toEqual(["1st-edition", "set-logo"]);
		expect(variant?.foil).toBe("pokeball");
		expect(variant?.size).toBe("standard");
	});

	it("survives a multi-stamp variant as a sorted array whatever order upstream sends", () => {
		// No card in the live Oddish line carries more than one stamp, so this is a synthetic
		// fixture — but the spec makes `stamp` a list and matched as a set, so the behaviour is
		// asserted rather than assumed.
		const forward = normaliseCard(
			"en",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [{ stamp: ["set-logo", "1st-edition", "bulbasaur"], variantId: "v" }],
			},
			"both",
		).card;
		const reversed = normaliseCard(
			"en",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [{ stamp: ["bulbasaur", "1st edition", "Set-Logo"], variantId: "v" }],
			},
			"both",
		).card;

		expect(forward?.variants[0]?.stamps).toEqual(["1st-edition", "bulbasaur", "set-logo"]);
		expect(reversed?.variants[0]?.stamps).toEqual(forward?.variants[0]?.stamps);
	});

	it("reports an axis value outside the known vocabulary instead of dropping it", () => {
		const result = normaliseCard(
			"nl",
			{
				...JUNGLE_GLOOM_EN,
				variants_detailed: [{ type: "Zilverfolie", variantId: "v" }],
			},
			"dex",
		);
		expect(result.card?.variants[0]?.finish).toBe("zilverfolie");
		expect(result.unknownAxisValues).toEqual([
			{
				axis: "finish",
				raw: "Zilverfolie",
				canonical: "zilverfolie",
				language: "nl",
				cardId: "base2-44",
			},
		]);
	});
});

describe("the legacy flat `variants` object", () => {
	it("is ignored entirely, even when `variants_detailed` is absent", () => {
		// The two disagree — `base1-58` reports one printing in the flat object and enumerates six
		// in the detailed one — so the flat object is not read at all, not even as a fallback.
		const result = normaliseCard(
			"en",
			{
				id: "base1-58",
				localId: "58",
				name: "Oddish",
				set: { id: "base1", name: "Base Set" },
				variants: { firstEdition: true, holo: true, normal: true, reverse: true, wPromo: true },
			},
			"both",
		);
		expect(result.card).not.toBeNull();
		expect(result.card?.variants).toEqual([]);
	});

	it("does not contribute a variant when the detailed form has fewer", () => {
		const card = normaliseCard("en", JUNGLE_GLOOM_EN, "both").card;
		// The flat object claims firstEdition and normal; the detailed form is the only source and
		// it says two, with the ids below.
		expect(card?.variants.map((v) => v.variantId)).toEqual([
			"endfynwn4n10gzq",
			"2fnyg4g532wu2uft0spaa3eefrz",
		]);
	});
});

describe("rejections", () => {
	it("rejects a TCG Pocket card on the authoritative set ID from the detail form", () => {
		const result = normaliseCard(
			"en",
			{ ...JUNGLE_GLOOM_EN, id: "A2b-002", localId: "002", set: { id: "A2b" } },
			"both",
		);
		expect(result.card).toBeNull();
		expect(result.rejected).toContain("A2b");
	});
});

describe("the image", () => {
	it("keeps upstream's URL verbatim and reads the series segment off it", () => {
		// The series is what `datas.json` nests sets under and nothing in the card payload names
		// it; the image URL is `{language}/{series}/{set}/{localId}`.
		const card = normaliseCard("en", JUNGLE_GLOOM_EN, "both").card;
		expect(card?.imageBase).toBe("https://assets.tcgdex.net/en/base/base2/44");
		expect(card?.imageSeries).toBe("base");
	});

	it("tolerates a card upstream has no image for", () => {
		// 115 of the 497 cards in the line have no `image` field at all.
		const card = normaliseCard("en", { ...JUNGLE_GLOOM_EN, image: undefined }, "both").card;
		expect(card?.imageBase).toBeNull();
		expect(card?.imageSeries).toBeNull();
	});
});
