import { describe, expect, it } from "vitest";
import { copyFieldsFrom, copyFormFrom, EMPTY_COPY_FORM } from "../../client/binder/copy-form.ts";
import { copyPresentation, ownershipLine } from "../../client/binder/presentation.ts";
import type { BinderEntry } from "../../shared/contract.ts";
import type { CopyDocument } from "../../shared/copies.ts";
import { formatGradeTenths, parseGradeTenths } from "../../shared/copies.ts";

/**
 * The sheet's form, as arithmetic rather than as pixels.
 *
 * The client converts and the server validates: the server never sees `8.5` or `12.50`, only `85`
 * tenths and `1250` minor units. So the conversions are the part of the form that can be wrong
 * about money and about grades, and they are here, where a test can reach them without a browser.
 */

function copyWith(overrides: Partial<CopyDocument>): CopyDocument {
	return {
		id: "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e",
		cardKey: "en:base2-44",
		variantId: "endfynwn4n10gzq",
		condition: null,
		grader: null,
		grade: null,
		certNo: null,
		priceMinor: null,
		currency: null,
		priceHomeMinor: null,
		homeCurrency: null,
		rateDate: null,
		acquiredAt: null,
		sourceType: null,
		sourceNote: null,
		note: null,
		status: "owned",
		disposedAt: null,
		disposalKind: null,
		createdAt: 1_800_000_000_000,
		updatedAt: 1_800_000_000_000,
		...overrides,
	};
}

describe("grades", () => {
	it("reads the label and stores tenths", () => {
		// `PSA 8.5` is `85`, so half grades and a grade parsed off a listing title compare exactly
		// rather than through the binary representation of 8.5.
		expect(parseGradeTenths("8.5")).toBe(85);
		expect(parseGradeTenths("10")).toBe(100);
		expect(parseGradeTenths("9")).toBe(90);
		expect(formatGradeTenths(85)).toBe("8.5");
		expect(formatGradeTenths(100)).toBe("10");
	});

	it("refuses a grade no grader issues", () => {
		// The units trap: a `9` typed into a field expecting tenths is 0.9 — a tenth of what was
		// meant, entirely plausible on inspection, and nothing below 1.0 exists on any of these
		// companies' scales.
		expect(parseGradeTenths("0.9")).toBeNull();
		expect(parseGradeTenths("11")).toBeNull();
		expect(parseGradeTenths("eight")).toBeNull();
	});
});

describe("the copy form", () => {
	it("turns what was typed into minor units of the currency beside it", () => {
		const parsed = copyFieldsFrom({
			...EMPTY_COPY_FORM,
			condition: "NM",
			priceAmount: "4200",
			currency: "JPY",
			homeAmount: "41.50",
			homeCurrency: "AUD",
			rateDate: "2026-02-11",
		});

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		// The yen has no minor unit: 4200, not 420000, and the home amount beside it does have one.
		expect(parsed.fields.priceMinor).toBe(4200);
		expect(parsed.fields.currency).toBe("JPY");
		expect(parsed.fields.priceHomeMinor).toBe(4150);
		expect(parsed.fields.rateDate).toBe("2026-02-11");
	});

	it("sends every empty field as an explicit null, so an edit can clear one", () => {
		// The patch route reads an absent key as *leave it alone*. A price the owner deleted has to
		// arrive as `null` or it survives the edit that removed it.
		const parsed = copyFieldsFrom(EMPTY_COPY_FORM);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(parsed.fields.priceMinor).toBeNull();
		// The currency box is pre-filled, but with no amount beside it there is nothing to pair.
		expect(parsed.fields.currency).toBeNull();
		expect(parsed.fields.condition).toBeNull();
		expect(parsed.fields.note).toBeNull();
	});

	it("says what is wrong rather than storing a rounded price", () => {
		const parsed = copyFieldsFrom({ ...EMPTY_COPY_FORM, priceAmount: "12.567", currency: "AUD" });
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.message).toContain("12.567");
	});

	it("refuses an amount with no currency", () => {
		const parsed = copyFieldsFrom({ ...EMPTY_COPY_FORM, priceAmount: "12.50", currency: "" });
		expect(parsed.ok).toBe(false);
	});

	it("round-trips an existing copy back into the form it came from", () => {
		const copy = copyWith({
			condition: "LP",
			grader: "PSA",
			grade: 85,
			certNo: "48219930",
			priceMinor: 62_000,
			currency: "JPY",
			priceHomeMinor: 61_250,
			homeCurrency: "AUD",
			rateDate: "2026-02-11",
			acquiredAt: "2026-02-10",
			sourceType: "ebay",
			note: "off-centre",
		});

		const values = copyFormFrom(copy);
		expect(values.grade).toBe("8.5");
		expect(values.priceAmount).toBe("62000");
		expect(values.homeAmount).toBe("612.50");

		const parsed = copyFieldsFrom(values);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.fields).toMatchObject({
			condition: "LP",
			grader: "PSA",
			grade: 85,
			certNo: "48219930",
			priceMinor: 62_000,
			currency: "JPY",
			priceHomeMinor: 61_250,
			homeCurrency: "AUD",
			rateDate: "2026-02-11",
			acquiredAt: "2026-02-10",
			sourceType: "ebay",
			note: "off-centre",
		});
	});
});

describe("how a copy reads in the sheet", () => {
	it("leads with the grade when there is one and the condition when there is not", () => {
		// A grade and a condition are different kinds of claim — the grading company's judgement
		// against the owner's — and the spec omits the condition for a slab so the two do not
		// compete. Whichever exists is the headline; they are never shown side by side.
		expect(copyPresentation(copyWith({ grader: "PSA", grade: 85 })).headline).toBe("PSA 8.5");
		expect(copyPresentation(copyWith({ condition: "NM" })).headline).toBe("NM");
		expect(copyPresentation(copyWith({})).headline).toBe("no condition recorded");
	});

	it("never shows an amount without its code, or a converted one without its date", () => {
		const shown = copyPresentation(
			copyWith({
				priceMinor: 62_000,
				currency: "JPY",
				priceHomeMinor: 61_250,
				homeCurrency: "AUD",
				rateDate: "2026-02-11",
			}),
		);

		expect(shown.detail).toContain("62000 JPY");
		// The rate date is part of the figure and not a footnote: the rate was typed by hand and
		// nothing in this application can work out which day it came from afterwards.
		expect(shown.detail).toContain("612.50 AUD @ 2026-02-11");
	});

	it("says a disposed copy is disposed without taking it off the list", () => {
		const shown = copyPresentation(
			copyWith({ status: "disposed", disposedAt: "2026-06-07", disposalKind: "traded" }),
		);
		expect(shown.disposal).toBe("disposed 2026-06-07 · traded");
	});
});

describe("what the sheet says is held", () => {
	function entryWith(ownedCopies: number): BinderEntry {
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
			provenance: "tcgdex",
			ownedCopies,
			priority: null,
		};
	}

	it("counts rather than ticking, because two copies of one printing is a fact", () => {
		expect(ownershipLine(entryWith(0))).toBe("needed");
		expect(ownershipLine(entryWith(1))).toBe("1 copy owned");
		expect(ownershipLine(entryWith(2))).toBe("2 copies owned");
	});
});
