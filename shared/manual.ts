/**
 * Hand-added variants and the exclusion list — the owner-authored half of the masterset.
 *
 * Korean and Simplified Chinese carry zero Oddish-line records upstream, and "The Best of XY"
 * is missing everywhere. Those rows are first class: they count toward completion, they survive
 * a re-import, and they mint identities in a reserved namespace TCGdex can never produce.
 *
 * **Entry is clone-and-edit.** The client copies the nearest printing's fields, mints two UUIDs,
 * and the server prefixes them `manual:`. A clone never inherits its source's `card_key` or
 * `variant_id`. A blank form is the same create with empty fields.
 *
 * Identifiers are **client-generated UUIDs** so an outbox replay is idempotent, the same rule as
 * copies. The server refuses anything that is not UUID-shaped and always applies the reserved
 * prefix itself.
 */

/** `POST /api/manual-variants` creates; `GET` is not a list — the binder is the list. */
export const MANUAL_VARIANTS_PATH = "/api/manual-variants";

/**
 * `PATCH` / `DELETE /api/manual-variants/{cardKey}/{variantId}`.
 *
 * Both halves of the identity carry a colon (`manual:{uuid}`), so they are path-encoded at both
 * ends, exactly as corpus image URLs encode `card_key`.
 */
export function manualVariantPath(cardKey: string, variantId: string): string {
	return `${MANUAL_VARIANTS_PATH}/${encodeURIComponent(cardKey)}/${encodeURIComponent(variantId)}`;
}

/** `GET` lists; `PUT` upserts one; `DELETE /api/corpus/exclusions/{cardKey}` removes one. */
export const CORPUS_EXCLUSIONS_PATH = "/api/corpus/exclusions";

export function corpusExclusionPath(cardKey: string): string {
	return `${CORPUS_EXCLUSIONS_PATH}/${encodeURIComponent(cardKey)}`;
}

/**
 * One hand-added card and the one variant created with it.
 *
 * Clone-and-edit always creates both. Identity is `(cardKey, variantId)` with both halves in
 * the reserved `manual:` namespace. Display fields — language, set, number, name, the five
 * axes — are what the owner typed, and they are *not* identity.
 */
export interface ManualVariantDocument {
	readonly cardKey: string;
	readonly variantId: string;
	readonly language: string;
	readonly setId: string;
	readonly setName: string | null;
	readonly localId: string;
	readonly name: string;
	readonly rarity: string | null;
	readonly finish: string | null;
	readonly subtype: string | null;
	readonly stamps: readonly string[];
	readonly foil: string | null;
	readonly size: string | null;
	readonly provenance: "manual";
}

/**
 * Recording a hand-added card and variant.
 *
 * `id` becomes `card_key = manual:{id}`. `variantId` becomes `variant_id = manual:{variantId}`.
 * Both are minted by the client. The source of a clone is not a field here: the client copies
 * the display fields and the server never sees the source identity, which is how a clone cannot
 * inherit it.
 */
export interface ManualVariantCreateRequest {
	readonly id: string;
	readonly variantId: string;
	readonly language: string;
	readonly setId: string;
	readonly setName?: string | null;
	readonly localId: string;
	readonly name: string;
	readonly rarity?: string | null;
	readonly finish?: string | null;
	readonly subtype?: string | null;
	readonly stamps?: readonly string[];
	readonly foil?: string | null;
	readonly size?: string | null;
}

/**
 * Editing a hand-added row.
 *
 * **An absent key leaves the field alone; an explicit `null` clears it.** Identity is not here:
 * a row's `card_key` and `variant_id` are minted once and never rewritten, so a re-import that
 * does not mention them still finds them.
 */
export interface ManualVariantPatchRequest {
	readonly language?: string;
	readonly setId?: string;
	readonly setName?: string | null;
	readonly localId?: string;
	readonly name?: string;
	readonly rarity?: string | null;
	readonly finish?: string | null;
	readonly subtype?: string | null;
	readonly stamps?: readonly string[];
	readonly foil?: string | null;
	readonly size?: string | null;
}

export interface CorpusExclusionDocument {
	readonly cardKey: string;
	readonly reason: string | null;
	readonly createdAt: number;
}

export interface CorpusExclusionListDocument {
	readonly exclusions: readonly CorpusExclusionDocument[];
}

/** `PUT /api/corpus/exclusions`. Idempotent: a second write of the same key is an update. */
export interface CorpusExclusionUpsertRequest {
	readonly cardKey: string;
	readonly reason?: string | null;
}
