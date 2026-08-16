import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBinderDocument, compareCardNumbers } from "../server/binder/document.ts";
import { readOwnedCopyCounts } from "../server/binder/ownership.ts";
import { insertCopy, setVariantPriority } from "../server/copies/repository.ts";
import { binderEntryKey } from "../shared/contract.ts";
import {
	EXPECTED_ORDER,
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The binder document, built against a real migrated SQLite database. The spec forbids mocking
 * the database and this is the seam every acceptance criterion on the ticket runs through.
 */
describe("the binder document", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function build(ownership?: ReadonlyMap<string, number>) {
		return buildBinderDocument({
			db: temp.handle.db,
			now: () => 1_800_000_000_000,
			...(ownership === undefined ? {} : { ownership }),
		});
	}

	it("carries every variant, unpaginated, in one document", () => {
		// The property the whole ticket rests on: one request is the masterset, not a page of it.
		// A route that quietly capped its result would take offline browsing with it.
		const document = build();
		expect(document.entries).toHaveLength(EXPECTED_ORDER.length);
		expect(document.generatedAt).toBe(1_800_000_000_000);
	});

	it("gives two cards sharing one variant_id two distinct entries", () => {
		// The regression this exists to stop: 817 live variants carry 21 distinct `variant_id`s,
		// the worst shared by 264 cards. Keyed on `variant_id` alone the binder renders 21 cells
		// and silently loses 796 — no error, no warning, just a much smaller collection.
		const document = build();
		const shared = document.entries.filter((entry) => entry.variantId === SHARED_VARIANT);

		expect(shared).toHaveLength(2);
		expect(shared.map((entry) => entry.cardKey).sort()).toEqual(["en:base1-45", "en:base2-44"]);
		expect(new Set(shared.map((entry) => entry.key)).size).toBe(2);
	});

	it("gives every entry a key composed of the card and the variant", () => {
		const document = build();
		const keys = document.entries.map((entry) => entry.key);

		expect(new Set(keys).size).toBe(keys.length);
		for (const entry of document.entries) {
			expect(entry.key).toBe(binderEntryKey(entry.cardKey, entry.variantId));
		}
	});

	it("orders by set release date descending, then card number", () => {
		const document = build();
		expect(document.entries.map((entry) => entry.key)).toEqual(EXPECTED_ORDER);
	});

	it("puts an undated set last, never first", () => {
		// A missing date must not read as year zero. Sorting nulls first would float the newest-
		// looking part of the binder — promos and hand-added rows — above every dated set.
		const document = build();
		const undated = document.entries.filter((entry) => entry.setReleaseDate === null);
		const dated = document.entries.filter((entry) => entry.setReleaseDate !== null);

		expect(undated).toHaveLength(2);
		const firstUndated = document.entries.findIndex((entry) => entry.setReleaseDate === null);
		expect(firstUndated).toBe(dated.length);
	});

	it("renders a card whose set has no row at all rather than dropping it", () => {
		// The sets phase runs after detail, so a card can exist for a whole sync before its set
		// does — and a set whose fetch 404d never gets a date. Either way the card is in the
		// masterset and has to be in the binder.
		const document = build();
		const orphan = document.entries.find((entry) => entry.setId === "swshp");

		expect(orphan).toBeDefined();
		expect(orphan?.setReleaseDate).toBeNull();
		// Falls back to the set name the card itself carries, so the sheet still reads sensibly.
		expect(orphan?.setName).toBe("SWSH Black Star Promos");
	});

	it("is byte-for-byte stable across two builds of the same corpus", () => {
		// The ETag is a hash of the body. An order that depended on the row order SQLite happened
		// to return would change the ETag without the corpus changing, and the phone would
		// re-download the whole document on every revalidation.
		const first = JSON.stringify(build().entries);
		const second = JSON.stringify(build().entries);
		expect(first).toBe(second);
	});

	it("reports every variant as needed when the owner holds nothing", () => {
		// An empty collection is zero everywhere, and it is the state the fixture starts in. If
		// this ever fails without a copy having been recorded, something is inventing ownership.
		const document = build();
		expect(readOwnedCopyCounts(temp.handle.db).size).toBe(0);
		expect(document.entries.every((entry) => entry.ownedCopies === 0)).toBe(true);
	});

	it("reads ownership out of the database when no index is supplied", () => {
		// The seam the binder ticket left, now filled: the document's default is what the copies
		// table actually holds. `tests/copies-repository.test.ts` covers the keying; this covers
		// that the document is wired to it rather than to the injected fixture alone.
		insertCopy(
			temp.handle.db,
			{
				id: "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e",
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
			},
			1_000,
		);

		const document = build();
		const owned = document.entries.filter((entry) => entry.ownedCopies > 0);
		expect(owned.map((entry) => entry.key)).toEqual([`en:base2-44 ${FIRST_EDITION_VARIANT}`]);
	});

	it("carries the variant's priority, unset until the owner sets one", () => {
		// The dial rides on the binder document so the sheet can render it the instant it opens,
		// offline included — the same reason ownership rides here.
		expect(build().entries.every((entry) => entry.priority === null)).toBe(true);

		setVariantPriority(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT, 3, 1_000);

		const document = build();
		expect(
			document.entries.find((entry) => entry.key === `en:base2-44 ${FIRST_EDITION_VARIANT}`)
				?.priority,
		).toBe(3);
		// The other printing of the same card, and the other card sharing a `variant_id`, are both
		// untouched — priority is keyed the same composite way as everything else.
		expect(
			document.entries.find((entry) => entry.key === `en:base2-44 ${SHARED_VARIANT}`)?.priority,
		).toBeNull();
	});

	it("marks exactly the owned variants when the ownership index has something in it", () => {
		// **The ownership distinction, flipped by input.** Written before the copies table existed,
		// to prove the whole path from the index through the document was wired; kept because it
		// still isolates the document's half of that path from the query that fills the index.
		const owned = new Map([[`en:base2-44 ${FIRST_EDITION_VARIANT}`, 2]]);
		const document = build(owned);

		const first = document.entries.find(
			(entry) => entry.key === `en:base2-44 ${FIRST_EDITION_VARIANT}`,
		);
		const sibling = document.entries.find((entry) => entry.key === `en:base2-44 ${SHARED_VARIANT}`);

		expect(first?.ownedCopies).toBe(2);
		// The other printing of the same card is untouched. Owning the 1st Edition is not owning
		// the Unlimited, which is the distinction the whole masterset exists to make.
		expect(sibling?.ownedCopies).toBe(0);
		expect(document.entries.filter((entry) => entry.ownedCopies > 0)).toHaveLength(1);
	});

	it("carries the five axes, with stamps as a list", () => {
		const document = build();
		const firstEdition = document.entries.find(
			(entry) => entry.key === `en:base2-44 ${FIRST_EDITION_VARIANT}`,
		);

		expect(firstEdition?.finish).toBe("normal");
		expect(firstEdition?.stamps).toEqual(["1st-edition"]);
		expect(firstEdition?.subtype).toBeNull();
		expect(firstEdition?.foil).toBeNull();
		expect(firstEdition?.size).toBe("standard");
	});

	it("says whether the card holds image bytes, so the grid does not ask for images that 404", () => {
		const document = build();
		const withArt = document.entries.find((entry) => entry.cardKey === "en:base2-44");
		const without = document.entries.find((entry) => entry.cardKey === "en:swshp-SWSH040");

		expect(withArt?.hasImage).toBe(true);
		expect(without?.hasImage).toBe(false);
	});

	it("keeps a variant whose card was flagged missing upstream, and says so", () => {
		// Flagged, never deleted. It stays in the binder because the spec's denominator rule
		// depends on it and because a copy may point at it.
		const document = build();
		const flagged = document.entries.find((entry) => entry.cardKey === "en:me02.5-002");

		expect(flagged).toBeDefined();
		expect(flagged?.missingUpstream).toBe(true);
		expect(document.entries.filter((entry) => entry.missingUpstream)).toHaveLength(1);
	});

	it("carries the set's own name and date rather than the card's copy of the name", () => {
		const document = build();
		const japanese = document.entries.find((entry) => entry.cardKey === "ja:SV3-002");

		expect(japanese?.setName).toBe("黒炎の支配者");
		// An ISO calendar date, exactly as upstream sent it. Never an epoch: a set released "on
		// 28 July" was not released at an instant, and converting it moves the day by timezone.
		expect(japanese?.setReleaseDate).toBe("2023-07-28");
	});
});

describe("card numbers", () => {
	it("sorts numerically, not lexically", () => {
		// `local_id` is text. A plain string sort puts 10 before 2 and scatters every set.
		expect(compareCardNumbers("2", "10")).toBeLessThan(0);
		expect(compareCardNumbers("44", "9")).toBeGreaterThan(0);
	});

	it("treats a zero-padded number as the same number", () => {
		expect(compareCardNumbers("002", "2")).not.toBe(0);
		expect(compareCardNumbers("002", "3")).toBeLessThan(0);
		expect(compareCardNumbers("010", "9")).toBeGreaterThan(0);
	});

	it("puts plain numbers before lettered ones, and orders those numerically too", () => {
		// Shining Fates numbers its main set 1..73 and its shiny vault SV1..SV122. A numeric cast
		// reads every SV card as zero and files the whole shiny vault before card 1.
		expect(compareCardNumbers("8", "SV3")).toBeLessThan(0);
		expect(compareCardNumbers("SV2", "SV10")).toBeLessThan(0);
		expect(compareCardNumbers("SWSH040", "SWSH9")).toBeGreaterThan(0);
	});

	it("is total, so two different numbers never compare equal", () => {
		// A comparator that returns 0 for distinct values makes the sort order depend on the
		// order SQLite returned the rows, which changes the document's ETag for no reason.
		for (const [a, b] of [
			["1", "01"],
			["H31", "H31a"],
			["TG05", "TG5"],
		] as const) {
			expect(compareCardNumbers(a, b)).not.toBe(0);
			expect(Math.sign(compareCardNumbers(a, b))).toBe(-Math.sign(compareCardNumbers(b, a)));
		}
	});
});
