import { describe, expect, it } from "vitest";
import {
	canonicaliseAxisValue,
	canonicaliseStamps,
	isKnownAxisValue,
	slugifyAxisValue,
} from "../server/corpus/canonical.ts";

/**
 * Every raw value asserted here was read off a live TCGdex response for an Oddish-line card.
 * Nothing is invented, so a failure means upstream moved rather than that the fixture was
 * optimistic.
 */
describe("stamp canonicalisation", () => {
	it("lands `1st-edition` and `1st edition` on the same value", () => {
		// The ruling the spec calls out by name: both spellings are live upstream in comparable
		// numbers — 18 and 16 occurrences in the Oddish line — and missing this silently drops
		// half the 1st Edition corpus while the filter still returns results.
		expect(canonicaliseAxisValue("stamp", "1st-edition")).toBe("1st-edition");
		expect(canonicaliseAxisValue("stamp", "1st edition")).toBe("1st-edition");
		expect(canonicaliseAxisValue("stamp", "1st-edition")).toBe(
			canonicaliseAxisValue("stamp", "1st edition"),
		);
	});

	it("lands the localised spellings on it too", () => {
		// French and German carry translated stamp text, not the slug. A binder filtered to
		// 1st Edition has to return them, because language is a filter and not a grouping.
		expect(canonicaliseAxisValue("stamp", "1re Édition")).toBe("1st-edition");
		expect(canonicaliseAxisValue("stamp", "1. Auflage")).toBe("1st-edition");
		expect(canonicaliseAxisValue("stamp", "Logo de la série")).toBe("set-logo");
		expect(canonicaliseAxisValue("stamp", "Set-Logo")).toBe("set-logo");
		expect(canonicaliseAxisValue("stamp", "Chris Fulop")).toBe("chris-fulop");
	});

	it("is order-independent, de-duplicated and sorted", () => {
		expect(canonicaliseStamps(["set-logo", "1st edition"])).toEqual(["1st-edition", "set-logo"]);
		expect(canonicaliseStamps(["1st-edition", "Set-Logo"])).toEqual(["1st-edition", "set-logo"]);
		expect(canonicaliseStamps(["1st edition", "1re Édition"])).toEqual(["1st-edition"]);
	});

	it("treats an absent stamp field as an empty list, not as a null", () => {
		// Upstream omits `stamp` entirely rather than sending an empty array.
		expect(canonicaliseStamps(undefined)).toEqual([]);
		expect(canonicaliseStamps(null)).toEqual([]);
		expect(canonicaliseStamps("1st-edition")).toEqual([]);
	});
});

describe("the other four axes", () => {
	it("folds each language's display string onto one token", () => {
		expect(canonicaliseAxisValue("finish", "Holo")).toBe("holo");
		expect(canonicaliseAxisValue("finish", "Olografica")).toBe("holo");
		expect(canonicaliseAxisValue("finish", "Normale")).toBe("normal");
		expect(canonicaliseAxisValue("finish", "básico")).toBe("normal");
		expect(canonicaliseAxisValue("finish", "reversa")).toBe("reverse");
		expect(canonicaliseAxisValue("size", "Padrão")).toBe("standard");
		expect(canonicaliseAxisValue("size", "estándar")).toBe("standard");
		expect(canonicaliseAxisValue("foil", "Énergie")).toBe("energy");
		expect(canonicaliseAxisValue("foil", "Energía")).toBe("energy");
		expect(canonicaliseAxisValue("foil", "Poké Ball")).toBe("pokeball");
		expect(canonicaliseAxisValue("foil", "Poké Bola")).toBe("pokeball");
		expect(canonicaliseAxisValue("foil", "Pokéball")).toBe("pokeball");
		expect(canonicaliseAxisValue("subtype", "Symbole d’extension manquant")).toBe(
			"missing-expansion-symbol",
		);
		expect(canonicaliseAxisValue("subtype", "Fehlendes Erweiterungssymbol")).toBe(
			"missing-expansion-symbol",
		);
	});

	it("leaves the already-canonical values alone", () => {
		for (const value of ["normal", "holo", "reverse"]) {
			expect(canonicaliseAxisValue("finish", value)).toBe(value);
		}
		expect(canonicaliseAxisValue("foil", "cracked-ice")).toBe("cracked-ice");
		expect(canonicaliseAxisValue("foil", "masterball")).toBe("masterball");
		expect(canonicaliseAxisValue("subtype", "unlimited")).toBe("unlimited");
	});

	it("keeps an unrecognised value rather than dropping it, and marks it unknown", () => {
		// A language TCGdex adds later must show up as an unknown axis value in the sync report,
		// not vanish. Dropping it would shrink the corpus in silence, which is the failure mode
		// the whole design is defending against.
		expect(canonicaliseAxisValue("finish", "Zilverfolie")).toBe("zilverfolie");
		expect(isKnownAxisValue("finish", "zilverfolie")).toBe(false);
		expect(isKnownAxisValue("finish", "holo")).toBe(true);
	});

	it("returns null for absent or empty values", () => {
		expect(canonicaliseAxisValue("foil", undefined)).toBeNull();
		expect(canonicaliseAxisValue("foil", "")).toBeNull();
		expect(canonicaliseAxisValue("foil", "   ")).toBeNull();
		expect(canonicaliseAxisValue("foil", 7)).toBeNull();
	});
});

describe("slugify", () => {
	it("strips diacritics, lowercases and collapses everything else to one hyphen", () => {
		expect(slugifyAxisValue("1re Édition")).toBe("1re-edition");
		expect(slugifyAxisValue("Symbole d’extension manquant")).toBe("symbole-d-extension-manquant");
		expect(slugifyAxisValue("  Poké  Ball  ")).toBe("poke-ball");
		expect(slugifyAxisValue("---")).toBe("");
	});
});
