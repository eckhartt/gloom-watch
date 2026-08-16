/**
 * `(TCGdex detail record) → (card row, variant rows)`.
 *
 * A pure transform with no database and no network, which is what makes the rulings it encodes
 * testable as behaviour rather than as internals.
 */

import {
	canonicaliseAxisValue,
	canonicaliseStamps,
	isKnownAxisValue,
	type VariantAxis,
} from "./canonical.ts";
import { cardKeyFor, isTcgPocketSetId, type MembershipReason } from "./membership.ts";
import { parseImageLocation, type TcgdexCardDetail, type TcgdexVariantDetailed } from "./tcgdex.ts";

export type Provenance = "tcgdex" | "manual";

export interface NormalisedVariant {
	readonly cardKey: string;
	/** Opaque token. `"generated"` is real upstream data and is stored exactly as received. */
	readonly variantId: string;
	readonly finish: string | null;
	readonly subtype: string | null;
	/** Canonicalised, de-duplicated, sorted. Serialised as JSON. */
	readonly stamps: readonly string[];
	readonly foil: string | null;
	readonly size: string | null;
	readonly upstreamRaw: string;
}

export interface NormalisedCard {
	readonly cardKey: string;
	readonly language: string;
	readonly cardId: string;
	readonly setId: string;
	readonly setName: string | null;
	readonly localId: string;
	readonly name: string;
	readonly category: string | null;
	readonly rarity: string | null;
	readonly dexIds: readonly number[];
	readonly membershipReason: MembershipReason;
	readonly imageBase: string | null;
	readonly imageSeries: string | null;
	readonly variants: readonly NormalisedVariant[];
}

/** An axis value that canonicalised to something outside the known vocabulary. */
export interface UnknownAxisValue {
	readonly axis: VariantAxis;
	readonly raw: string;
	readonly canonical: string;
	readonly language: string;
	readonly cardId: string;
}

export interface NormaliseResult {
	readonly card: NormalisedCard | null;
	/** Why the record was dropped, when it was. */
	readonly rejected: string | null;
	readonly unknownAxisValues: readonly UnknownAxisValue[];
}

function canonicaliseWithReport(
	axis: VariantAxis,
	raw: unknown,
	language: string,
	cardId: string,
	unknown: UnknownAxisValue[],
): string | null {
	const canonical = canonicaliseAxisValue(axis, raw);
	if (canonical !== null && typeof raw === "string" && !isKnownAxisValue(axis, canonical)) {
		unknown.push({ axis, raw, canonical, language, cardId });
	}
	return canonical;
}

function normaliseVariant(
	cardKey: string,
	language: string,
	cardId: string,
	upstream: TcgdexVariantDetailed,
	unknown: UnknownAxisValue[],
): NormalisedVariant | null {
	// No identity, no row. Never invent one: a synthesised id would collide with a real one on
	// the next sync and silently renumber the owner's collection.
	if (typeof upstream.variantId !== "string" || upstream.variantId === "") return null;

	const stamps = canonicaliseStamps(upstream.stamp);
	for (const raw of upstream.stamp ?? []) {
		canonicaliseWithReport("stamp", raw, language, cardId, unknown);
	}

	return {
		cardKey,
		variantId: upstream.variantId,
		finish: canonicaliseWithReport("finish", upstream.type, language, cardId, unknown),
		subtype: canonicaliseWithReport("subtype", upstream.subtype, language, cardId, unknown),
		stamps,
		foil: canonicaliseWithReport("foil", upstream.foil, language, cardId, unknown),
		size: canonicaliseWithReport("size", upstream.size, language, cardId, unknown),
		// Pricing is stripped: it is out of scope and it changes hourly, so keeping it would mark
		// every row dirty on every sync.
		upstreamRaw: JSON.stringify({
			variantId: upstream.variantId,
			type: upstream.type,
			subtype: upstream.subtype,
			stamp: upstream.stamp,
			foil: upstream.foil,
			size: upstream.size,
		}),
	};
}

/**
 * Normalise one detail record.
 *
 * **`variants_detailed` is the only source of variants.** The legacy flat `variants`
 * `{firstEdition, holo, normal, reverse, wPromo}` object arrives on every response and the two
 * disagree — `base1-58` reports a single printing there and enumerates six here — so it is not
 * read at all, not even as a fallback. A card that carries no `variants_detailed` yields no
 * variant rows rather than variants invented from the flat object.
 */
export function normaliseCard(
	language: string,
	detail: TcgdexCardDetail,
	membershipReason: MembershipReason,
): NormaliseResult {
	const unknown: UnknownAxisValue[] = [];

	const setId = detail.set?.id;
	if (typeof setId !== "string" || setId === "") {
		return { card: null, rejected: "no set id", unknownAxisValues: unknown };
	}
	// Re-checked against the authoritative set ID from the detail form. Phase 1 derives the set
	// from the card ID to avoid fetching, and this is the backstop for that derivation.
	if (isTcgPocketSetId(setId)) {
		return { card: null, rejected: `tcg pocket set ${setId}`, unknownAxisValues: unknown };
	}

	const cardKey = cardKeyFor(language, detail.id);
	const imageBase = typeof detail.image === "string" && detail.image !== "" ? detail.image : null;
	const location = imageBase === null ? null : parseImageLocation(imageBase);

	const variants: NormalisedVariant[] = [];
	const seen = new Set<string>();
	for (const upstream of detail.variants_detailed ?? []) {
		const variant = normaliseVariant(cardKey, language, detail.id, upstream, unknown);
		if (variant === null) continue;
		// Identity is `(card, variant_id)`, so a repeated id within one card is one row.
		if (seen.has(variant.variantId)) continue;
		seen.add(variant.variantId);
		variants.push(variant);
	}

	return {
		card: {
			cardKey,
			language,
			cardId: detail.id,
			setId,
			setName: detail.set?.name ?? null,
			localId: String(detail.localId),
			name: detail.name,
			category: detail.category ?? null,
			rarity: detail.rarity ?? null,
			dexIds: detail.dexId ?? [],
			membershipReason,
			imageBase,
			imageSeries: location?.series ?? null,
			variants,
		},
		rejected: null,
		unknownAxisValues: unknown,
	};
}
