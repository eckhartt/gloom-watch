/**
 * The matcher's return shape. A listing resolves to a **resolution**, not a variant.
 *
 * Grain is explicit because card-grain is the ordinary case — `Gloom Jungle 44/64` names a
 * card and leaves several printings live. Guessing one of them is the silent error the
 * precision bias exists to prevent. `variantId` is therefore set only at variant grain.
 *
 * `cardKey` is `{language}:{card_id}`. Language is part of identity, so a bare TCGdex id
 * would collide across namespaces. `variantId` is opaque and is never a key on its own.
 */

import type { CopyGrader } from "./copies.ts";

/** Bumped when the function that produces a resolution changes. */
export const MATCHER_VERSION = "matcher-1";

export type MatchGrain = "variant" | "card" | "none";

/** Filtered listings stay in the feed with a reason. They are never silently dropped. */
export type FilterVerdict = "pass" | "filtered";

export interface VariantCandidate {
	readonly cardKey: string;
	readonly variantId: string;
	readonly finish: string | null;
	readonly subtype: string | null;
	readonly stamps: readonly string[];
	readonly foil: string | null;
	readonly size: string | null;
}

/**
 * What the matcher decided, and at what grain.
 *
 * Invariants the resolver holds:
 * - `variantId` is non-null if and only if `grain === "variant"`
 * - `candidates` is non-null if and only if `grain === "card"`
 * - `cardKey` is set at card and variant grain, and unset at none
 * - every resolution carries `confidence` and `matcherVersion`
 */
export interface ListingResolution {
	readonly grain: MatchGrain;
	readonly cardKey: string | null;
	readonly variantId: string | null;
	readonly candidates: readonly VariantCandidate[] | null;
	readonly language: string;
	readonly confidence: number;
	readonly matcherVersion: string;
	readonly isLot: boolean;
	readonly lotNames: readonly string[] | null;
	readonly filterVerdict: FilterVerdict;
	readonly filterReason: string | null;
	readonly parsedGrader: CopyGrader | null;
	readonly parsedGrade: number | null;
}

export interface MatcherVariant {
	readonly variantId: string;
	readonly finish: string | null;
	readonly subtype: string | null;
	readonly stamps: readonly string[];
	readonly foil: string | null;
	readonly size: string | null;
}

export interface MatcherCard {
	readonly cardKey: string;
	readonly language: string;
	readonly cardId: string;
	readonly setId: string;
	readonly setName: string | null;
	readonly setAbbreviation: string | null;
	readonly localId: string;
	readonly name: string;
	readonly variants: readonly MatcherVariant[];
}

/** Closed local lookup table. The matcher never reaches the network for this. */
export interface MatcherCorpus {
	readonly cards: readonly MatcherCard[];
}

/**
 * Owner-authored mapping from a phrase seen in the wild to a card, or a variant.
 *
 * An alias may resolve to a variant — that is how the confirm queue will drain for
 * partly-owned cards. The matcher itself still never guesses one.
 */
export interface MatcherAlias {
	readonly phrase: string;
	readonly cardKey: string;
	readonly variantId: string | null;
}

export interface ListingMatchInput {
	readonly title: string;
	readonly itemLocationCountry: string | null;
	readonly aspects: Readonly<Record<string, string>>;
}

/** A one-line summary the feed can render as-is. */
export function describeResolution(match: ListingResolution): string {
	const parts: string[] = [match.grain];
	if (match.cardKey !== null) parts.push(match.cardKey);
	if (match.grain === "variant" && match.variantId !== null) parts.push(match.variantId);
	if (match.grain === "card" && match.candidates !== null) {
		parts.push(`${match.candidates.length} candidate${match.candidates.length === 1 ? "" : "s"}`);
	}
	if (match.isLot) {
		const names = match.lotNames ?? [];
		parts.push(names.length > 0 ? `lot (${names.join(", ")})` : "lot");
	}
	if (match.filterVerdict === "filtered") {
		parts.push(match.filterReason ?? "filtered");
	}
	parts.push(match.language, match.confidence.toFixed(2), match.matcherVersion);
	return parts.join(" · ");
}
