import { describe, expect, it } from "vitest";
import {
	type BriefRecord,
	cardKeyFor,
	isTcgPocketSetId,
	selectMembers,
	setIdFromCardId,
} from "../server/corpus/membership.ts";

function brief(partial: Partial<BriefRecord> & Pick<BriefRecord, "cardId">): BriefRecord {
	return {
		language: "en",
		localId: partial.cardId.slice(partial.cardId.lastIndexOf("-") + 1),
		name: "Oddish",
		dexIds: [],
		...partial,
	};
}

describe("TCG Pocket exclusion", () => {
	it("excludes by prefix, so the suffixed set IDs do not slip through", () => {
		// The whole point of the ruling. All 15 live TCG Pocket set IDs, checked against the
		// `tcgp` series membership: an equality list built from A1/A2/A3/A4/B1/B2/P-A misses
		// A1a, A2a, A2b, A3a, A3b, A4a, B1a and B2a — more than half of them.
		const pocket = [
			"P-A",
			"A1",
			"A1a",
			"A2",
			"A2a",
			"A2b",
			"A3",
			"A3a",
			"A3b",
			"A4",
			"A4a",
			"B1",
			"B1a",
			"B2",
			"B2a",
		];
		for (const setId of pocket) expect(isTcgPocketSetId(setId)).toBe(true);
	});

	it("leaves the physical sets alone", () => {
		// Nothing in the other 203 sets matches, including the ones that start with a letter the
		// pattern cares about.
		const physical = [
			"base1",
			"base2",
			"basep",
			"neo1",
			"ecard2",
			"sv03",
			"sv03.5",
			"swsh12.5",
			"me02.5",
			"SV3",
			"S9a",
			"PMCG2",
			"tk-ex-m",
			"xyp",
			"bw7",
		];
		for (const setId of physical) expect(isTcgPocketSetId(setId)).toBe(false);
	});

	it("keeps a TCG Pocket card out of the masterset", () => {
		const members = selectMembers([
			brief({ cardId: "A2b-002", localId: "002", name: "Gloom", dexIds: [44] }),
			brief({ cardId: "B1a-001", localId: "001", name: "Oddish", dexIds: [43] }),
			brief({ cardId: "base2-44", localId: "44", name: "Gloom", dexIds: [44] }),
		]);
		expect(members.map((m) => m.cardId)).toEqual(["base2-44"]);
	});
});

describe("membership is a union, and both halves are needed", () => {
	it("admits a card the dex sweep alone would miss", () => {
		// Live: `me02.5-001` Erika's Oddish, `me02.5-002` Erika's Gloom and `me02.5-003` Erika's
		// Vileplume ex carry no dexId at all.
		const members = selectMembers([
			brief({ cardId: "me02.5-002", localId: "002", name: "Erika's Gloom", dexIds: [] }),
		]);
		expect(members).toHaveLength(1);
		expect(members[0]?.reason).toBe("name");
	});

	it("admits a card the name sweep alone would miss", () => {
		// Live: every non-English printing. The sweep is for the four English species names, so a
		// French `Mystherbe` or a Japanese `ナゾノクサ` only ever arrives through its dex number.
		const members = selectMembers([
			brief({ language: "fr", cardId: "base2-44", localId: "44", name: "Ortide", dexIds: [44] }),
			brief({
				language: "ja",
				cardId: "SV3-002",
				localId: "002",
				name: "クサイハナ",
				dexIds: [44],
			}),
		]);
		expect(members.map((m) => m.reason)).toEqual(["dex", "dex"]);
	});

	it("records `both` when the two halves agree", () => {
		const members = selectMembers([
			brief({ cardId: "base2-44", localId: "44", name: "Gloom", dexIds: [44] }),
		]);
		expect(members[0]?.reason).toBe("both");
	});

	it("does not admit a card that matches neither", () => {
		const members = selectMembers([
			brief({ cardId: "base1-4", localId: "4", name: "Charizard", dexIds: [6] }),
		]);
		expect(members).toEqual([]);
	});

	it("admits a substring hit, which is what makes the trainer-owned prints work", () => {
		const names = ["Erika's Vileplume ex", "Dark Gloom", "Gloom δ", "Bellossom GX"];
		const members = selectMembers(
			names.map((name, i) => brief({ cardId: `x-${i}`, localId: String(i), name })),
		);
		expect(members).toHaveLength(names.length);
	});
});

describe("the exclusions table", () => {
	it("removes a card the owner ruled out, before any detail is fetched", () => {
		const excluded = new Set([cardKeyFor("en", "base2-44")]);
		const members = selectMembers(
			[
				brief({ cardId: "base2-44", localId: "44", name: "Gloom", dexIds: [44] }),
				brief({ cardId: "base1-45", localId: "45", name: "Vileplume", dexIds: [45] }),
			],
			{ excluded },
		);
		expect(members.map((m) => m.cardId)).toEqual(["base1-45"]);
	});

	it("is language-specific, because the exclusion key carries the language", () => {
		const excluded = new Set([cardKeyFor("en", "base2-44")]);
		const members = selectMembers(
			[
				brief({ cardId: "base2-44", localId: "44", name: "Gloom", dexIds: [44] }),
				brief({ language: "fr", cardId: "base2-44", localId: "44", name: "Ortide", dexIds: [44] }),
			],
			{ excluded },
		);
		expect(members.map((m) => m.language)).toEqual(["fr"]);
	});
});

describe("deriving the set ID from a brief record", () => {
	it("handles set IDs that themselves contain hyphens", () => {
		expect(setIdFromCardId("base2-44", "44")).toBe("base2");
		expect(setIdFromCardId("tk-ex-m-1", "1")).toBe("tk-ex-m");
		expect(setIdFromCardId("P-A-001", "001")).toBe("P-A");
		expect(setIdFromCardId("sv03.5-043", "043")).toBe("sv03.5");
		expect(setIdFromCardId("ecard2-H31", "H31")).toBe("ecard2");
	});
});

describe("re-scoping", () => {
	it("is a re-filter over records already held, not a new crawl", () => {
		// The reason phase 1 is stored rather than streamed. Changing the boundary re-runs this
		// function over the same rows; only the newly-included cards need a detail fetch.
		const records = [
			brief({ cardId: "base2-44", localId: "44", name: "Gloom", dexIds: [44] }),
			brief({ cardId: "base1-46", localId: "46", name: "Paras", dexIds: [46] }),
		];
		expect(selectMembers(records).map((m) => m.cardId)).toEqual(["base2-44"]);
		expect(
			selectMembers(records, { dexIds: [43, 44, 45, 46, 182], species: ["gloom", "paras"] }).map(
				(m) => m.cardId,
			),
		).toEqual(["base2-44", "base1-46"]);
	});
});
