import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertCopy } from "../server/copies/repository.ts";
import { copies } from "../server/db/schema.ts";
import { loadMatcherCorpus } from "../server/matcher/corpus.ts";
import { resolveListing } from "../server/matcher/resolve.ts";
import type { ListingMatchInput, ListingResolution, MatcherAlias } from "../shared/matcher.ts";
import { MATCHER_VERSION } from "../shared/matcher.ts";
import { FIRST_EDITION_VARIANT, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import {
	ERIKA_FIRST_EDITION_VARIANT_ID,
	FIRST_EDITION_VARIANT_ID,
	MATCHER_CORPUS,
	SHARED_VARIANT_ID,
} from "./helpers/matcher-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The shipped resolver, driven on fixture titles. The function is called twice on every
 * title: same inputs must produce the same object, and a module-level `/g` regex that
 * retained `lastIndex` would fail that on the second pass.
 */

function input(
	title: string,
	extra: {
		readonly country?: string | null;
		readonly aspects?: Readonly<Record<string, string>>;
	} = {},
): ListingMatchInput {
	return {
		title,
		itemLocationCountry: extra.country === undefined ? null : extra.country,
		aspects: extra.aspects ?? {},
	};
}

function resolveTwice(
	title: string,
	extra: {
		readonly country?: string | null;
		readonly aspects?: Readonly<Record<string, string>>;
		readonly aliases?: readonly MatcherAlias[];
	} = {},
): ListingResolution {
	const listing = input(title, extra);
	const aliases = extra.aliases ?? [];
	const first = resolveListing(listing, MATCHER_CORPUS, aliases);
	const second = resolveListing(listing, MATCHER_CORPUS, aliases);
	expect(first).toEqual(second);
	expect(first.matcherVersion).toBe(MATCHER_VERSION);
	if (first.grain === "variant") {
		expect(first.variantId).not.toBeNull();
		expect(first.cardKey).not.toBeNull();
		expect(first.candidates).toBeNull();
	} else {
		expect(first.variantId).toBeNull();
	}
	if (first.grain === "card") {
		expect(first.candidates).not.toBeNull();
		expect(first.cardKey).not.toBeNull();
	}
	if (first.grain === "none") {
		expect(first.cardKey).toBeNull();
		expect(first.candidates).toBeNull();
	}
	return first;
}

describe("the matcher", () => {
	it("resolves an English catalog title to the card and carries every live printing", () => {
		const match = resolveTwice("Pokemon TCG Gloom Jungle 44/64");
		expect(match.grain).toBe("card");
		expect(match.cardKey).toBe("en:base2-44");
		expect(match.variantId).toBeNull();
		expect(match.candidates).toHaveLength(4);
		expect(match.candidates?.every((candidate) => candidate.cardKey === "en:base2-44")).toBe(true);
		expect(match.language).toBe("en");
		expect(match.filterVerdict).toBe("pass");
		expect(match.isLot).toBe(false);
	});

	it("treats 1st-edition and 1st edition as the same stamp", () => {
		const hyphen = resolveTwice("Gloom Jungle 44/64 1st-edition");
		const space = resolveTwice("Gloom Jungle 44/64 1st edition");
		expect(hyphen).toEqual(space);
		expect(hyphen.grain).toBe("variant");
		expect(hyphen.cardKey).toBe("en:base2-44");
		expect(hyphen.variantId).toBe(FIRST_EDITION_VARIANT_ID);
		expect(hyphen.candidates).toBeNull();
	});

	it("picks the card a colliding variant_id belongs to, not the other card sharing the id", () => {
		const gloom = resolveTwice("Gloom Jungle 44/64 1st edition");
		expect(gloom.grain).toBe("variant");
		expect(gloom.cardKey).toBe("en:base2-44");
		expect(gloom.variantId).toBe(FIRST_EDITION_VARIANT_ID);
		expect(gloom.variantId).not.toBe(SHARED_VARIANT_ID);

		const vileplume = resolveTwice("Vileplume Base Set 45");
		expect(vileplume.grain).toBe("variant");
		expect(vileplume.cardKey).toBe("en:base1-45");
		expect(vileplume.variantId).toBe(SHARED_VARIANT_ID);
	});

	it("falls through marker then country then English, and the default lowers confidence", () => {
		const marked = resolveTwice("English Gloom Jungle 44/64");
		const fromCountry = resolveTwice("Gloom Jungle 44/64", { country: "US" });
		const defaulted = resolveTwice("Gloom Jungle 44/64");

		expect(marked.language).toBe("en");
		expect(fromCountry.language).toBe("en");
		expect(defaulted.language).toBe("en");
		expect(defaulted.confidence).toBeLessThan(marked.confidence);
		expect(defaulted.confidence).toBeLessThan(fromCountry.confidence);

		const japanese = resolveTwice("Japanese クサイハナ 黒炎の支配者 002");
		expect(japanese.language).toBe("ja");
		expect(japanese.cardKey).toBe("ja:SV3-002");
	});

	it("matches kana and kanji titles to the Japanese card", () => {
		const match = resolveTwice("ポケモンカードゲーム クサイハナ 黒炎の支配者 002/108");
		expect(match.grain).toBe("variant");
		expect(match.cardKey).toBe("ja:SV3-002");
		expect(match.language).toBe("ja");
		expect(match.variantId).not.toBeNull();
	});

	it("flags lots by multiple names or lot keywords and never links a variant", () => {
		const names = resolveTwice("Gloom Oddish Vileplume collection");
		expect(names.isLot).toBe(true);
		expect(names.grain).toBe("none");
		expect(names.variantId).toBeNull();
		expect(names.cardKey).toBeNull();
		expect(names.lotNames).toEqual(["Gloom", "Oddish", "Vileplume"]);

		const keyword = resolveTwice("Pokemon Gloom Jungle 44/64 lot of 50");
		expect(keyword.isLot).toBe(true);
		expect(keyword.grain).toBe("none");
		expect(keyword.variantId).toBeNull();
	});

	it("filters proxies and custom art with a reason and does not drop them", () => {
		const titled = resolveTwice("Gloom Jungle 44/64 custom art proxy");
		expect(titled.filterVerdict).toBe("filtered");
		expect(titled.filterReason).toMatch(/proxy|custom art/i);
		expect(titled.grain).toBe("card");
		expect(titled.cardKey).toBe("en:base2-44");

		const aspect = resolveTwice("Gloom Jungle 44/64", {
			aspects: { "Altered/Custom Art": "Yes" },
		});
		expect(aspect.filterVerdict).toBe("filtered");
		expect(aspect.filterReason).toMatch(/Altered\/Custom Art/i);
		expect(aspect.grain).toBe("card");
	});

	it("parses a slab grade onto the listing and ignores it when selecting a variant", () => {
		const raw = resolveTwice("Gloom Jungle 44/64 1st edition");
		const slab = resolveTwice("PSA 9 Gloom Jungle 44/64 1st edition");
		expect(slab.parsedGrader).toBe("PSA");
		expect(slab.parsedGrade).toBe(90);
		expect(raw.parsedGrader).toBeNull();
		expect(raw.parsedGrade).toBeNull();
		expect(slab.grain).toBe(raw.grain);
		expect(slab.cardKey).toBe(raw.cardKey);
		expect(slab.variantId).toBe(raw.variantId);
		expect(slab.candidates).toEqual(raw.candidates);
	});

	it("resolves a vintage free-form title to the same Jungle Gloom", () => {
		const match = resolveTwice("WOTC Jungle Set Gloom Uncommon 44 of 64");
		expect(match.cardKey).toBe("en:base2-44");
		expect(match.grain).toBe("card");
	});

	it("resolves trainer-owned and mechanic variants to their own cards", () => {
		const trainer = resolveTwice("Erika's Gloom Gym Heroes 45");
		expect(trainer.cardKey).toBe("en:gym1-45");
		expect(trainer.grain).toBe("card");
		expect(trainer.candidates).toHaveLength(2);

		const trainerFirst = resolveTwice("Erika's Gloom Gym Heroes 45 1st edition");
		expect(trainerFirst.grain).toBe("variant");
		expect(trainerFirst.variantId).toBe(ERIKA_FIRST_EDITION_VARIANT_ID);

		const mechanic = resolveTwice("Gloom δ Holon Phantoms 42");
		expect(mechanic.cardKey).toBe("en:ex13-42");
		expect(mechanic.grain).toBe("variant");

		const deltaWord = resolveTwice("Gloom Delta Holon Phantoms 42");
		expect(deltaWord.cardKey).toBe("en:ex13-42");

		const dark = resolveTwice("Dark Gloom Team Rocket 36");
		expect(dark.cardKey).toBe("en:base5-36");
	});

	it("lets an alias force a previously unplaceable phrase onto a variant", () => {
		const before = resolveTwice("the swamp flower holo");
		expect(before.grain).toBe("none");

		const after = resolveTwice("the swamp flower holo", {
			aliases: [
				{ phrase: "swamp flower", cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT_ID },
			],
		});
		expect(after.grain).toBe("variant");
		expect(after.cardKey).toBe("en:base2-44");
		expect(after.variantId).toBe(FIRST_EDITION_VARIANT_ID);
	});

	it("records confidence and matcher version on every grain, including none", () => {
		const none = resolveTwice("Charizard Base Set 4/102");
		expect(none.grain).toBe("none");
		expect(none.confidence).toBe(0);
		expect(none.matcherVersion).toBe(MATCHER_VERSION);
	});
});

describe("the matcher never writes ownership", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	it("leaves the copies table untouched after resolving a card-grain title", () => {
		insertCopy(
			temp.handle.db,
			{
				id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
			},
			1,
		);
		const before = temp.handle.db.select().from(copies).all();
		expect(before).toHaveLength(1);

		const corpus = loadMatcherCorpus(temp.handle.db);
		const match = resolveListing(input("Gloom Jungle 44/64"), corpus);
		expect(match.grain).toBe("card");
		expect(match.candidates).not.toBeNull();
		resolveListing(input("Gloom Jungle 44/64"), corpus);

		const after = temp.handle.db.select().from(copies).all();
		expect(after).toEqual(before);
	});
});
