import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { binderEntryKey } from "../../shared/contract.ts";
import type { ListingDocument } from "../../shared/listings.ts";
import type { ListingResolution } from "../../shared/matcher.ts";
import type { QueueCandidate, QueueItem, QueueState } from "../../shared/queue.ts";
import { isQueueState } from "../../shared/queue.ts";
import type { OwnershipIndex } from "../binder/ownership.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { ListingQueueStateRow } from "../db/schema.ts";
import { listingQueueStates, listings } from "../db/schema.ts";

export type { ListingQueueStateRow };

export function readQueueState(db: GloomDatabase, itemId: string): ListingQueueStateRow | null {
	return (
		db.select().from(listingQueueStates).where(eq(listingQueueStates.itemId, itemId)).get() ?? null
	);
}

export function readQueueStates(
	db: GloomDatabase,
	itemIds: readonly string[],
): Map<string, ListingQueueStateRow> {
	if (itemIds.length === 0) return new Map();
	const rows = db
		.select()
		.from(listingQueueStates)
		.where(inArray(listingQueueStates.itemId, [...itemIds]))
		.all();
	return new Map(rows.map((row) => [row.itemId, row]));
}

export function readQueuedItemIds(db: GloomDatabase): string[] {
	return db
		.select({ itemId: listingQueueStates.itemId })
		.from(listingQueueStates)
		.where(eq(listingQueueStates.state, "queued"))
		.all()
		.map((row) => row.itemId);
}

export function countQueued(db: GloomDatabase): number {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(listingQueueStates)
		.where(eq(listingQueueStates.state, "queued"))
		.get();
	return Number(row?.n ?? 0);
}

export function upsertQueueState(
	db: GloomDatabase,
	row: {
		readonly itemId: string;
		readonly state: QueueState;
		readonly phrase: string | null;
		readonly resolvedCardKey: string | null;
		readonly resolvedVariantId: string | null;
		readonly updatedAt: number;
	},
): ListingQueueStateRow {
	db.insert(listingQueueStates)
		.values({
			itemId: row.itemId,
			state: row.state,
			phrase: row.phrase,
			resolvedCardKey: row.resolvedCardKey,
			resolvedVariantId: row.resolvedVariantId,
			updatedAt: row.updatedAt,
		})
		.onConflictDoUpdate({
			target: listingQueueStates.itemId,
			set: {
				state: row.state,
				phrase: row.phrase,
				resolvedCardKey: row.resolvedCardKey,
				resolvedVariantId: row.resolvedVariantId,
				updatedAt: row.updatedAt,
			},
		})
		.run();
	const written = readQueueState(db, row.itemId);
	if (written === null) throw new Error("the queue state write wrote no row");
	return written;
}

export function queueStateOf(row: ListingQueueStateRow | null): QueueState {
	if (row === null) return "unattempted";
	return isQueueState(row.state) ? row.state : "unattempted";
}

export function toQueueItem(
	listing: ListingDocument,
	match: ListingResolution,
	owned: OwnershipIndex,
): QueueItem {
	return {
		listing,
		queueState: "queued",
		match,
		candidates: candidatesWithOwnership(match, owned),
	};
}

export function candidatesWithOwnership(
	match: ListingResolution,
	owned: OwnershipIndex,
): QueueCandidate[] | null {
	if (match.candidates === null) return null;
	return match.candidates.map((candidate) => ({
		...candidate,
		ownedCopies: owned.get(binderEntryKey(candidate.cardKey, candidate.variantId)) ?? 0,
	}));
}

/** Queued listings, newest observation first. */
export function readQueuedListingRows(db: GloomDatabase) {
	return db
		.select({ listing: listings, state: listingQueueStates })
		.from(listingQueueStates)
		.innerJoin(listings, eq(listings.itemId, listingQueueStates.itemId))
		.where(eq(listingQueueStates.state, "queued"))
		.orderBy(desc(listings.observedAt), asc(listings.itemId))
		.all();
}
