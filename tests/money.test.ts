import { describe, expect, it } from "vitest";
import {
	formatMinorAmount,
	formatMoney,
	isCurrencyCode,
	minorUnitExponent,
	parseAmountToMinor,
} from "../shared/money.ts";

/**
 * Money is integer minor units paired with an ISO 4217 code, never a float.
 *
 * The arithmetic that turns a typed string into those units is where that rule is actually kept or
 * quietly broken, and its worst failure is silent: a price a hundred times too large, stored
 * without complaint, on a collection that is largely Japanese.
 */

describe("minor units", () => {
	it("knows the yen has none", () => {
		// **¥4,200 is 4200 minor units, not 420,000.** A blanket multiply-by-a-hundred would store
		// every Japanese price a hundred times over, and a large part of this masterset is
		// Japanese — so it would be most of the collection, and nothing would report it.
		expect(minorUnitExponent("JPY")).toBe(0);
		expect(parseAmountToMinor("4200", "JPY")).toBe(4200);
		expect(formatMoney(4200, "JPY")).toBe("4200 JPY");
	});

	it("gives two digits to everything ordinary and three to the currencies that have them", () => {
		expect(parseAmountToMinor("12.50", "AUD")).toBe(1250);
		expect(parseAmountToMinor("12.50", "USD")).toBe(1250);
		// Wrong by a factor of ten if assumed to be two, which is the only reason to name them.
		expect(minorUnitExponent("KWD")).toBe(3);
		expect(parseAmountToMinor("12.500", "KWD")).toBe(12_500);
	});

	it("pads a short fraction rather than reading it as the whole minor part", () => {
		// `12.5` is twelve fifty, not twelve and five cents.
		expect(parseAmountToMinor("12.5", "AUD")).toBe(1250);
		expect(parseAmountToMinor("12", "AUD")).toBe(1200);
	});

	it("rejects more decimal places than the currency has, rather than rounding them away", () => {
		// A silent round stores an amount the owner never typed and gives them no way to notice.
		expect(parseAmountToMinor("12.567", "AUD")).toBeNull();
		expect(parseAmountToMinor("4200.5", "JPY")).toBeNull();
	});

	it("rejects everything that is not an amount", () => {
		expect(parseAmountToMinor("", "AUD")).toBeNull();
		expect(parseAmountToMinor("$12.50", "AUD")).toBeNull();
		expect(parseAmountToMinor("twelve", "AUD")).toBeNull();
		// Not a price paid.
		expect(parseAmountToMinor("-5", "AUD")).toBeNull();
	});

	it("survives a round trip in both directions", () => {
		for (const [amount, currency] of [
			["12.50", "AUD"],
			["0.99", "USD"],
			["4200", "JPY"],
			["1250.00", "EUR"],
		] as const) {
			const minor = parseAmountToMinor(amount, currency);
			expect(minor).not.toBeNull();
			expect(formatMinorAmount(minor ?? 0, currency)).toBe(amount);
		}
	});

	it("never renders an amount without its code", () => {
		// `1250` is $12.50 in AUD and ¥1,250 in JPY. A number without its code is one nobody can
		// read back, which is the whole reason the two columns are written together.
		expect(formatMoney(1250, "AUD")).toBe("12.50 AUD");
		expect(formatMoney(1250, "JPY")).toBe("1250 JPY");
	});

	it("recognises the shape of a code and nothing else", () => {
		expect(isCurrencyCode("AUD")).toBe(true);
		expect(isCurrencyCode("aud")).toBe(false);
		expect(isCurrencyCode("A$")).toBe(false);
		expect(isCurrencyCode("")).toBe(false);
		expect(isCurrencyCode(12)).toBe(false);
	});
});
