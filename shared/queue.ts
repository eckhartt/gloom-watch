/**
 * Confirm-queue membership and the owner-authored aliases that drain it.
 *
 * Queue state is **stored**, never inferred from a confidence score. `not_a_match` and
 * `unattempted` must stay distinct or the queue either re-asks forever or cannot be emptied.
 *
 * An alias may resolve to a variant, not only a card. The matcher still never guesses one;
 * an owner picking a variant in the queue is not a guess.
 */

import type { CopyCreateRequest, CopyDocument } from "./copies.ts";
import type { ListingDocument } from "./listings.ts";
import type { ListingResolution, VariantCandidate } from "./matcher.ts";

export const QUEUE_STATES = [
	"unattempted",
	"auto_matched",
	"queued",
	"resolved",
	"not_a_match",
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** Owner rulings. Re-scoring never moves these back onto the queue. */
export const TERMINAL_QUEUE_STATES = ["resolved", "not_a_match"] as const;
export type TerminalQueueState = (typeof TERMINAL_QUEUE_STATES)[number];

export function isQueueState(value: string): value is QueueState {
	return (QUEUE_STATES as readonly string[]).includes(value);
}

export function isTerminalQueueState(value: string): value is TerminalQueueState {
	return (TERMINAL_QUEUE_STATES as readonly string[]).includes(value);
}

/** Starting threshold from the spec. `>=` auto-matches; `<` queues. */
export const MATCH_CONFIDENCE_THRESHOLD = 0.85;

export const QUEUE_PATH = "/api/queue";
export const ALIASES_PATH = "/api/aliases";

export function queueItemPath(itemId: string): string {
	return `${QUEUE_PATH}/${encodeURIComponent(itemId)}`;
}

export function queueConfirmPath(itemId: string): string {
	return `${queueItemPath(itemId)}/confirm`;
}

export function queueVariantPath(itemId: string): string {
	return `${queueItemPath(itemId)}/variant`;
}

export function queueRejectPath(itemId: string): string {
	return `${queueItemPath(itemId)}/reject`;
}

export function aliasPath(id: string): string {
	return `${ALIASES_PATH}/${encodeURIComponent(id)}`;
}

/** A candidate the owner can pick, with whether they already hold that printing. */
export interface QueueCandidate extends VariantCandidate {
	readonly ownedCopies: number;
}

export interface QueueItem {
	readonly listing: ListingDocument;
	readonly queueState: "queued";
	readonly match: ListingResolution;
	readonly candidates: readonly QueueCandidate[] | null;
}

export interface QueueDocument {
	readonly generatedAt: number;
	readonly depth: number;
	readonly listings: readonly QueueItem[];
}

export interface AliasDocument {
	readonly id: string;
	readonly phrase: string;
	readonly cardKey: string;
	/** Set when the owner picked a variant. Null is card grain. */
	readonly variantId: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface AliasListDocument {
	readonly aliases: readonly AliasDocument[];
}

export interface AliasCreateRequest {
	readonly id: string;
	readonly phrase: string;
	readonly cardKey: string;
	readonly variantId?: string | null;
}

export interface AliasPatchRequest {
	readonly phrase?: string;
	readonly cardKey?: string;
	readonly variantId?: string | null;
}

/**
 * Confirm the matcher's current card or variant, or name one when grain is `none`.
 *
 * `phrase` defaults to the listing title. `recordCopy` is the only path from this ticket that
 * may write a copy — and only when a variant is known.
 */
export interface QueueConfirmRequest {
	readonly phrase?: string;
	readonly cardKey?: string;
	readonly variantId?: string | null;
	readonly recordCopy?: QueueCopyWrite;
}

/** Pick one printing of the resolved card. Teaches a variant-grain alias. */
export interface QueuePickVariantRequest {
	readonly variantId: string;
	readonly phrase?: string;
	readonly recordCopy?: QueueCopyWrite;
}

/** The client-minted copy to write. `cardKey` / `variantId` come from the ruling, not here. */
export type QueueCopyWrite = Omit<CopyCreateRequest, "cardKey" | "variantId">;

export interface QueueResolutionDocument {
	readonly itemId: string;
	readonly queueState: TerminalQueueState;
	readonly phrase: string | null;
	readonly cardKey: string | null;
	readonly variantId: string | null;
	readonly alias: AliasDocument | null;
	readonly copy: CopyDocument | null;
}
