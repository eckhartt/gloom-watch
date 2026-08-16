/**
 * Canonicalising the five variant axes.
 *
 * The spec names the axes and their observed values from an English inspection:
 * `finish` (normal/holo/reverse), `subtype`, `stamps[]`, `foil` and `size`. Against the live
 * API across every language that carries the Oddish line, the values are **not** a fixed
 * vocabulary — TCGdex returns *display strings in the card's own language*, mixed with the
 * slug form, sometimes both within one language:
 *
 * ```
 * type     normal(279) Normal(135) Reverse(125) reverse(90) holo(72) Holo(54)
 *          reversa(22,es) básico(16,es) Normale(16,it) Olografica(9,it)
 * size     standard(347) Standard(343) estándar(64,es) Padrão(64,pt)
 * foil     pokeball masterball energy Energia(it,pt) Pokéball(es) Poké Ball(it)
 *          Poké Bola(pt) Énergie(fr) cracked-ice
 * stamp    1st-edition(18,en+ja) "1st edition"(16,ja) "1re Édition"(11,fr)
 *          "1. Auflage"(11,de) set-logo Set-Logo(de) "Logo de la série"(fr)
 *          ross-cawthorn bulbasaur chris-fulop "Chris Fulop"(fr)
 * subtype  unlimited(ja) missing-expansion-symbol(en)
 *          "Symbole d’extension manquant"(fr) "Fehlendes Erweiterungssymbol"(de)
 * ```
 *
 * The spec makes all four filterable axes filterable **across** the corpus while language is a
 * filter rather than a grouping, so a binder narrowed to holo must return the Italian
 * `Olografica` rows too. Storing the upstream string would silently split every axis by
 * language — the same class of defect as the `1st edition` spelling the spec calls out, just
 * larger.
 *
 * So canonicalisation runs in two steps:
 *
 * 1. **Slug** — NFKD, drop combining marks, lowercase, runs of anything else to one hyphen.
 *    This alone settles `1st-edition` ≡ `1st edition`, `Holo` ≡ `holo`, `Set-Logo` ≡ `set-logo`.
 * 2. **Synonym** — an explicit, per-axis table mapping a localised slug onto the English token.
 *    Hand-authored from the values above, which are the values live data actually contains.
 *
 * An unrecognised value is **kept as its slug and counted**, never dropped: a language TCGdex
 * adds later shows up in the sync report as an unknown axis value rather than vanishing.
 */

export type VariantAxis = "finish" | "subtype" | "stamp" | "foil" | "size";

/**
 * Slug form: lowercase ASCII words joined by hyphens.
 *
 * `Padrão` → `padrao`, `1re Édition` → `1re-edition`, `Symbole d’extension manquant` →
 * `symbole-d-extension-manquant`. The typographic apostrophe needs no special case because it
 * is simply not `[a-z0-9]`.
 */
export function slugifyAxisValue(raw: string): string {
	return raw
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Localised slug → canonical token, per axis. Every entry is a value observed in a live
 * response; nothing here is anticipated. Entries whose slug already equals the canonical token
 * (`set-logo`, `chris-fulop`, `1st edition`) are absent because step 1 has already settled them.
 */
const SYNONYMS: Readonly<Record<VariantAxis, Readonly<Record<string, string>>>> = {
	finish: {
		normale: "normal",
		basico: "normal",
		olografica: "holo",
		reversa: "reverse",
	},
	subtype: {
		"symbole-d-extension-manquant": "missing-expansion-symbol",
		"fehlendes-erweiterungssymbol": "missing-expansion-symbol",
	},
	stamp: {
		"1re-edition": "1st-edition",
		"1-auflage": "1st-edition",
		"logo-de-la-serie": "set-logo",
	},
	foil: {
		energia: "energy",
		energie: "energy",
		"poke-ball": "pokeball",
		"poke-bola": "pokeball",
	},
	size: {
		estandar: "standard",
		padrao: "standard",
	},
};

/**
 * The tokens each axis is expected to produce. Used only to decide whether a value is worth
 * reporting as unknown — it is **not** a filter, and a value outside this set is still stored.
 * Widening the vocabulary is how a genuinely new upstream value is accepted.
 */
export const KNOWN_AXIS_VALUES: Readonly<Record<VariantAxis, readonly string[]>> = {
	finish: ["normal", "holo", "reverse"],
	subtype: [
		"unlimited",
		"shadowless",
		"shadowless-red-cheek",
		"1999-2000-copyright",
		"missing-expansion-symbol",
	],
	stamp: ["1st-edition", "set-logo", "bulbasaur", "chris-fulop", "ross-cawthorn"],
	foil: ["cracked-ice", "energy", "pokeball", "masterball"],
	size: ["standard"],
};

/** `null` for an absent or empty upstream value; the axes are all optional upstream. */
export function canonicaliseAxisValue(axis: VariantAxis, raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const slug = slugifyAxisValue(raw);
	if (slug === "") return null;
	return SYNONYMS[axis][slug] ?? slug;
}

export function isKnownAxisValue(axis: VariantAxis, value: string): boolean {
	return KNOWN_AXIS_VALUES[axis].includes(value);
}

/**
 * `stamps` is a list, canonicalised and **order-independent**: canonicalise, de-duplicate, then
 * sort, so two variants carrying the same stamps in different upstream order compare equal as
 * stored text.
 *
 * Upstream sends the field as `stamp`, singular, and omits it entirely when there are none.
 */
export function canonicaliseStamps(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const canonical = new Set<string>();
	for (const entry of raw) {
		const value = canonicaliseAxisValue("stamp", entry);
		if (value !== null) canonical.add(value);
	}
	return [...canonical].sort();
}
