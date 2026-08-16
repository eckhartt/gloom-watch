import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOwnedCopyCounts } from "../server/binder/ownership.ts";
import {
	disposeCopy,
	insertCopy,
	readVariantCopies,
	readVariantPriority,
	setVariantPriority,
	updateCopy,
} from "../server/copies/repository.ts";
import { binderEntryKey } from "../shared/contract.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The copies table, against a real migrated database. The spec forbids mocking the database, and
 * the invariants worth holding here — that a copy is one object, that disposal keeps the row,
 * that ownership is keyed on the composite identity — are all properties of what lands in it.
 */

const RAW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLAB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("copies", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	it("holds two copies of one variant with different conditions and prices", () => {
		// **A copy is one physical card, never a quantity.** A PSA 9 and a raw copy of the same
		// printing are two rows, because the cert number, the condition and the price paid all
		// describe one object and a count of two would have nowhere to put the second of each.
		insertCopy(
			temp.handle.db,
			{
				id: RAW,
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
				condition: "LP",
				priceMinor: 4500,
				currency: "AUD",
			},
			1_000,
		);
		insertCopy(
			temp.handle.db,
			{
				id: SLAB,
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
				grader: "PSA",
				grade: 90,
				certNo: "48219930",
				priceMinor: 62_000,
				currency: "JPY",
			},
			1_000,
		);

		const held = readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT);
		expect(held).toHaveLength(2);
		expect(held.find((copy) => copy.id === RAW)?.condition).toBe("LP");
		// Omitted for the slab: the number on the label is the condition, and the owner's second
		// opinion recorded beside it would only compete with the grader's.
		expect(held.find((copy) => copy.id === SLAB)?.condition).toBeNull();
		// ¥62,000 is 62000 minor units, not 6,200,000. The yen has no minor unit and a blanket
		// multiply-by-a-hundred would store every Japanese price a hundred times too large.
		expect(held.map((copy) => copy.priceMinor).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
			4500, 62_000,
		]);
		expect(held.find((copy) => copy.id === SLAB)?.grade).toBe(90);

		// Two rows, one variant: ownership is a count, not a boolean.
		const ownership = readOwnedCopyCounts(temp.handle.db);
		expect(ownership.get(binderEntryKey("en:base2-44", FIRST_EDITION_VARIANT))).toBe(2);
	});

	it("keeps a disposed copy's row and drops it out of ownership", () => {
		// The whole reason the ownership filter has to exist: nothing is deleted, so the purchase
		// history survives and the count has to be told which rows still mean something.
		insertCopy(
			temp.handle.db,
			{
				id: RAW,
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
				priceMinor: 4500,
				currency: "AUD",
				note: "picked up at a fair",
			},
			1_000,
		);
		disposeCopy(
			temp.handle.db,
			RAW,
			{ disposedAt: "2026-03-04", disposalKind: "sold", note: "upgraded to a PSA 8" },
			2_000,
		);

		const held = readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT);
		expect(held).toHaveLength(1);
		expect(held[0]?.status).toBe("disposed");
		expect(held[0]?.disposedAt).toBe("2026-03-04");
		expect(held[0]?.disposalKind).toBe("sold");
		// What it cost is still there. That is the point of retaining the row rather than deleting
		// it, and an upgrade trail nobody can price is not a trail.
		expect(held[0]?.priceMinor).toBe(4500);
		// The disposal's note is appended, not substituted; what was written at purchase stands.
		expect(held[0]?.note).toBe("picked up at a fair\nupgraded to a PSA 8");

		expect(readOwnedCopyCounts(temp.handle.db).size).toBe(0);
	});

	it("lists what is held before what was let go", () => {
		// The two statuses sort `disposed` before `owned` alphabetically, so a naive ascending order
		// opens the sheet with the cards the owner no longer has — a list of losses.
		insertCopy(
			temp.handle.db,
			{ id: RAW, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1_000,
		);
		insertCopy(
			temp.handle.db,
			{ id: SLAB, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			2_000,
		);
		disposeCopy(temp.handle.db, RAW, { disposedAt: "2026-03-04" }, 3_000);

		const held = readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT);
		expect(held.map((copy) => copy.id)).toEqual([SLAB, RAW]);
	});

	it("leaves the first disposal's date alone if the same copy is disposed of twice", () => {
		// A replayed disposal — the outbox will do exactly this — must not move the date. The card
		// went once, and the second attempt is the same act arriving late.
		insertCopy(
			temp.handle.db,
			{ id: RAW, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1_000,
		);
		disposeCopy(temp.handle.db, RAW, { disposedAt: "2026-03-04", disposalKind: "sold" }, 2_000);
		disposeCopy(temp.handle.db, RAW, { disposedAt: "2026-09-09", disposalKind: "lost" }, 3_000);

		const held = readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT);
		expect(held[0]?.disposedAt).toBe("2026-03-04");
		expect(held[0]?.disposalKind).toBe("sold");
	});

	it("does not mark another card owned because it shares a variant_id", () => {
		// **The collapse, and it is live on real data.** 817 variants in the corpus carry 21
		// distinct `variant_id`s, the worst shared by 264 cards. Keyed on `variant_id` alone,
		// owning one Jungle Gloom would report a Base Set Vileplume as owned too — no error, no
		// warning, just hundreds of cards the owner does not have.
		insertCopy(
			temp.handle.db,
			{ id: OTHER_CARD, cardKey: "en:base2-44", variantId: SHARED_VARIANT },
			1_000,
		);

		const ownership = readOwnedCopyCounts(temp.handle.db);
		expect(ownership.get(binderEntryKey("en:base2-44", SHARED_VARIANT))).toBe(1);
		expect(ownership.get(binderEntryKey("en:base1-45", SHARED_VARIANT))).toBeUndefined();
		expect(ownership.size).toBe(1);
	});

	it("does not mark the other printing of the same card owned", () => {
		// Owning the 1st Edition is not owning the Unlimited. That distinction is the reason the
		// masterset is at variant grain at all.
		insertCopy(
			temp.handle.db,
			{ id: RAW, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1_000,
		);

		const ownership = readOwnedCopyCounts(temp.handle.db);
		expect(ownership.get(binderEntryKey("en:base2-44", FIRST_EDITION_VARIANT))).toBe(1);
		expect(ownership.get(binderEntryKey("en:base2-44", SHARED_VARIANT))).toBeUndefined();
	});

	it("replays a create into the same row rather than a second card", () => {
		// What makes the outbox idempotent in a later ticket: the identifier is the client's, so a
		// create whose response was lost on a dropping tailnet lands here twice and means once.
		const request = {
			id: RAW,
			cardKey: "en:base2-44",
			variantId: FIRST_EDITION_VARIANT,
			condition: "NM" as const,
		};
		const first = insertCopy(temp.handle.db, request, 1_000);
		const second = insertCopy(temp.handle.db, request, 2_000);

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT)).toHaveLength(1);
		// The first write stands: a replay must not be able to rewrite a copy edited since.
		expect(second.row.createdAt).toBe(1_000);
	});

	it("clears a field on an explicit null and leaves an absent one alone", () => {
		// The patch convention. Without it the owner could never remove a price they typed wrong,
		// because an empty field and an untouched field would look identical on the wire.
		insertCopy(
			temp.handle.db,
			{
				id: RAW,
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
				condition: "NM",
				priceMinor: 4500,
				currency: "AUD",
			},
			1_000,
		);

		const patched = updateCopy(temp.handle.db, RAW, { priceMinor: null, currency: null }, 2_000);
		expect(patched.priceMinor).toBeNull();
		expect(patched.currency).toBeNull();
		expect(patched.condition).toBe("NM");
		expect(patched.updatedAt).toBe(2_000);
	});

	it("sets and clears a priority without touching the corpus row it points at", () => {
		// Priority lives in its own table so a corpus re-import cannot take it with it — the sync
		// has no reason to write here and no statement in the corpus repository names this table.
		setVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT, 3, 1_000);
		expect(readVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT)).toBe(3);

		setVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT, 0, 2_000);
		// `0` is a real rung, not an absence — which is why clearing deletes the row instead.
		expect(readVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT)).toBe(0);

		setVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT, null, 3_000);
		expect(readVariantPriority(temp.handle.db, "en:base2-44", SHARED_VARIANT)).toBeNull();
		// And the other card sharing that `variant_id` never had one.
		expect(readVariantPriority(temp.handle.db, "en:base1-45", SHARED_VARIANT)).toBeNull();
	});

	it("refuses a copy of a variant the masterset does not hold", () => {
		// The composite foreign key, enforced by SQLite rather than intended. A copy pointing at
		// half an identity would be a copy of up to 264 different cards at once.
		expect(() =>
			insertCopy(
				temp.handle.db,
				{ id: RAW, cardKey: "en:base2-44", variantId: "not-a-printing" },
				1_000,
			),
		).toThrow();
	});

	it("refuses a grade with no grader, in the database and not only in the validator", () => {
		// The rule is a CHECK as well as a validation, because an import route and an outbox replay
		// are both coming and a rule enforced in a request handler holds only for requests.
		expect(() =>
			insertCopy(
				temp.handle.db,
				{ id: RAW, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT, grade: 90 },
				1_000,
			),
		).toThrow();
	});

	it("refuses a home-currency amount with no rate date", () => {
		// The rate is typed by hand and there is no FX API to recover it from, so an amount stored
		// without the day it was taken is a number nobody can ever interpret again.
		expect(() =>
			insertCopy(
				temp.handle.db,
				{
					id: RAW,
					cardKey: "en:base2-44",
					variantId: FIRST_EDITION_VARIANT,
					priceHomeMinor: 4500,
					homeCurrency: "AUD",
				},
				1_000,
			),
		).toThrow();
	});
});
