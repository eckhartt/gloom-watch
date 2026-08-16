import { describe, expect, it } from "vitest";
import {
	axisRows,
	cellPresentation,
	setLine,
	variantBadge,
} from "../../client/binder/presentation.ts";
import type { BinderEntry } from "../../shared/contract.ts";

/**
 * How a binder cell reads.
 *
 * Two of the ticket's criteria are claims about pixels — that owned and needed are
 * distinguishable at a glance, and that the sheet shows the variant's axes. Neither can be
 * asserted against a phone in CI, but the decision each of them turns on is a pure function over
 * one entry, and that is what these hold.
 */
function entryWith(overrides: Partial<BinderEntry>): BinderEntry {
	return {
		key: "en:base2-44 endfynwn4n10gzq",
		cardKey: "en:base2-44",
		variantId: "endfynwn4n10gzq",
		language: "en",
		setId: "base2",
		setName: "Jungle",
		setReleaseDate: "1999-06-16",
		localId: "44",
		name: "Gloom",
		rarity: "Uncommon",
		finish: "normal",
		subtype: null,
		stamps: [],
		foil: null,
		size: "standard",
		hasImage: true,
		missingUpstream: false,
		ownedCopies: 0,
		...overrides,
	};
}

describe("owned and needed", () => {
	it("changes the cell's treatment when ownership changes, and nothing else about it", () => {
		// **The distinction, flipped by input.** Every entry on the live box says zero copies
		// today because the copies table is the next ticket — so this is the only place the
		// owned treatment is exercised at all until it lands.
		const needed = cellPresentation(entryWith({ ownedCopies: 0 }));
		const owned = cellPresentation(entryWith({ ownedCopies: 1 }));

		expect(needed.owned).toBe(false);
		expect(owned.owned).toBe(true);
		expect(needed.state).toBe("needed");
		expect(owned.state).toBe("owned");
		expect(owned.className).not.toBe(needed.className);
	});

	it("says which it is in the accessible name too, not only in colour", () => {
		// "Distinguishable at a glance without reading text" is about the sighted case. It must
		// not become "distinguishable only by colour", which is a coin flip for some readers.
		expect(cellPresentation(entryWith({ ownedCopies: 0 })).label).toContain("needed");
		expect(cellPresentation(entryWith({ ownedCopies: 3 })).label).toContain("owned");
	});

	it("counts copies rather than answering yes or no", () => {
		// A PSA 9 and a raw copy of one variant are two rows, not one boolean. Shaped now so the
		// copies ticket fills the number in rather than re-shaping the contract.
		expect(cellPresentation(entryWith({ ownedCopies: 2 })).owned).toBe(true);
		expect(entryWith({ ownedCopies: 2 }).ownedCopies).toBe(2);
	});

	it("names the card, the set and the language, since one card exists in eleven of them", () => {
		const label = cellPresentation(
			entryWith({ language: "ja", name: "クサイハナ", setName: "黒炎の支配者", localId: "002" }),
		).label;

		expect(label).toContain("クサイハナ");
		expect(label).toContain("黒炎の支配者");
		expect(label).toContain("JA");
	});
});

describe("the variant badge", () => {
	it("tells two printings of one card apart", () => {
		// Images attach to the card, so the Unlimited and the 1st Edition Jungle Gloom are two
		// cells carrying one picture. Without a badge the owner sees two identical tiles.
		const unlimited = variantBadge(entryWith({ finish: "normal", stamps: [] }));
		const firstEdition = variantBadge(entryWith({ finish: "normal", stamps: ["1st-edition"] }));

		expect(unlimited).toBe("");
		expect(firstEdition).toBe("1ED");
	});

	it("says nothing for a plain normal printing, which is most of the grid", () => {
		expect(variantBadge(entryWith({ finish: "normal", size: "standard" }))).toBe("");
	});

	it("marks the finishes that are a collecting distinction", () => {
		expect(variantBadge(entryWith({ finish: "holo" }))).toBe("HOLO");
		expect(variantBadge(entryWith({ finish: "reverse" }))).toBe("REV");
	});

	it("puts the stamp first, because it is what a collector reads first", () => {
		const badge = variantBadge(
			entryWith({ stamps: ["1st-edition"], subtype: "shadowless", finish: "holo" }),
		);
		expect(badge.startsWith("1ED")).toBe(true);
	});

	it("shows an axis value nobody has a code for rather than dropping it", () => {
		// The corpus canonicalises upstream's localised axis strings and reports what it could
		// not place. A tile that rendered an unknown value as blank would present it as an
		// unmarked normal printing, which is exactly the wrong answer.
		expect(variantBadge(entryWith({ finish: null, foil: "rainbow-mirror" }))).toBe(
			"RAINBOW-MIRROR",
		);
	});
});

describe("the sheet", () => {
	it("lists all five axes, including the ones upstream did not set", () => {
		const rows = axisRows(entryWith({ finish: "holo", foil: null, stamps: ["1st-edition"] }));

		expect(rows.map((row) => row.label)).toEqual(["Finish", "Subtype", "Stamps", "Foil", "Size"]);
		expect(rows.find((row) => row.label === "Foil")?.value).toBe("—");
		expect(rows.find((row) => row.label === "Stamps")?.value).toBe("1st-edition");
	});

	it("renders a multi-stamp variant as the list it is", () => {
		const rows = axisRows(entryWith({ stamps: ["1st-edition", "set-logo"] }));
		expect(rows.find((row) => row.label === "Stamps")?.value).toBe("1st-edition, set-logo");
	});

	it("prints the release date verbatim, never through a Date", () => {
		// `new Date("1999-06-16")` is midnight UTC. Formatted west of UTC that reads as the 15th —
		// a release date that changes depending on where the reader is standing. It is a calendar
		// date, not an instant, and the string upstream sent is the answer.
		expect(setLine(entryWith({ setReleaseDate: "1999-06-16" }))).toContain("1999-06-16");
		expect(setLine(entryWith({ setReleaseDate: null }))).toContain("no release date");
	});
});
