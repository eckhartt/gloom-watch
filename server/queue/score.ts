/**
 * Decide and persist queue membership.
 *
 * The decision is a function of the resolution, the owner's holdings, and the threshold —
 * and then it is *written*. A later read does not re-derive `queued` from confidence, which
 * is how `not_a_match` stays distinct from `unattempted`.
 *
 * Terminal states (`resolved`, `not_a_match`) are never overwritten by a rescore.
 */

import { eq } from "drizzle-orm";
import { binderEntryKey } from "../../shared/contract.ts";
import type { ListingResolution, MatcherAlias, MatcherCorpus } from "../../shared/matcher.ts";
import {
	isTerminalQueueState,
	MATCH_CONFIDENCE_THRESHOLD,
	type QueueState,
} from "../../shared/queue.ts";
import { loadMatcherAliases } from "../aliases/repository.ts";
import { type OwnershipIndex, readOwnedCopyCounts } from "../binder/ownership.ts";
import type { GloomDatabase } from "../db/client.ts";
import { listingQueueStates, listings } from "../db/schema.ts";
import { loadMatcherCorpus } from "../matcher/corpus.ts";
import { resolveListing } from "../matcher/resolve.ts";

function parseAspects(raw: string): Readonly<Record<string, string>> {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const aspects: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") aspects[key] = value;
		}
		return aspects;
	} catch {
		return {};
	}
}

import {
	type ListingQueueStateRow,
	readQueuedItemIds,
	readQueueState,
	upsertQueueState,
} from "./repository.ts";

export function decideQueueState(
	match: ListingResolution,
	ownedOfCard: { readonly owned: number; readonly total: number } | null,
	threshold: number = MATCH_CONFIDENCE_THRESHOLD,
): Exclude<QueueState, "unattempted" | "resolved" | "not_a_match"> {
	if (match.filterVerdict === "filtered" || match.isLot) return "auto_matched";
	if (match.grain === "none") return "queued";
	if (
		match.grain === "card" &&
		ownedOfCard !== null &&
		ownedOfCard.owned > 0 &&
		ownedOfCard.owned < ownedOfCard.total
	) {
		return "queued";
	}
	if (match.confidence < threshold) return "queued";
	return "auto_matched";
}

export function cardOwnership(
	cardKey: string,
	corpus: MatcherCorpus,
	owned: OwnershipIndex,
): { readonly owned: number; readonly total: number } | null {
	const card = corpus.cards.find((entry) => entry.cardKey === cardKey);
	if (card === undefined || card.variants.length === 0) return null;
	let held = 0;
	for (const variant of card.variants) {
		if ((owned.get(binderEntryKey(cardKey, variant.variantId)) ?? 0) > 0) held += 1;
	}
	return { owned: held, total: card.variants.length };
}

export interface ScoreContext {
	readonly corpus: MatcherCorpus;
	readonly aliases: readonly MatcherAlias[];
	readonly owned: OwnershipIndex;
	readonly now: number;
}

export function loadScoreContext(db: GloomDatabase, now: number): ScoreContext {
	return {
		corpus: loadMatcherCorpus(db),
		aliases: loadMatcherAliases(db),
		owned: readOwnedCopyCounts(db),
		now,
	};
}

/**
 * Score one listing. Missing and `unattempted` rows are decided; terminal rows stay put.
 * `auto_matched` and `queued` are rewritten so a newly taught alias can pull a sibling
 * off the queue.
 */
export function scoreListing(
	db: GloomDatabase,
	itemId: string,
	ctx: ScoreContext,
): ListingQueueStateRow {
	const existing = readQueueState(db, itemId);
	if (existing !== null && isTerminalQueueState(existing.state)) return existing;

	const row = db.select().from(listings).where(eq(listings.itemId, itemId)).get();
	if (row === undefined) {
		return (
			existing ??
			upsertQueueState(db, {
				itemId,
				state: "unattempted",
				phrase: null,
				resolvedCardKey: null,
				resolvedVariantId: null,
				updatedAt: ctx.now,
			})
		);
	}

	const match = resolveListing(
		{
			title: row.title,
			itemLocationCountry: row.itemLocationCountry,
			aspects: parseAspects(row.aspects),
		},
		ctx.corpus,
		ctx.aliases,
	);
	const owned = match.cardKey === null ? null : cardOwnership(match.cardKey, ctx.corpus, ctx.owned);
	const state = decideQueueState(match, owned);
	return upsertQueueState(db, {
		itemId,
		state,
		phrase: existing?.phrase ?? null,
		resolvedCardKey: match.cardKey,
		resolvedVariantId: match.variantId,
		updatedAt: ctx.now,
	});
}

export function scoreItemIds(db: GloomDatabase, itemIds: readonly string[], now: number): void {
	if (itemIds.length === 0) return;
	const ctx = loadScoreContext(db, now);
	for (const itemId of itemIds) {
		scoreListing(db, itemId, ctx);
	}
}

/** Re-run every live queued row after the alias table changes. */
export function rescoreOpenQueue(db: GloomDatabase, now: number): void {
	const ctx = loadScoreContext(db, now);
	for (const itemId of readQueuedItemIds(db)) {
		scoreListing(db, itemId, ctx);
	}
}

/** Score listings that have never been decided, so queue depth is not missing them. */
export function scoreUnscoredListings(db: GloomDatabase, now: number): void {
	const rows = db.select({ itemId: listings.itemId }).from(listings).all();
	const known = new Set(
		db
			.select({ itemId: listingQueueStates.itemId })
			.from(listingQueueStates)
			.all()
			.map((row) => row.itemId),
	);
	const missing = rows.map((row) => row.itemId).filter((itemId) => !known.has(itemId));
	scoreItemIds(db, missing, now);
}
