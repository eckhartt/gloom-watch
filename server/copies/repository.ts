/**
 * Reading and writing copies and variant priorities. No HTTP and no validation — the SQL lives
 * here so there is one place to look for what touches the owner's collection.
 *
 * **There is no delete.** Not "there is no delete route": there is no statement in this file that
 * removes a copy. Disposal moves the status and keeps the row, because the purchase history and
 * the upgrade trail are the reason the row exists after the card has gone.
 *
 * **The ownership query is not here.** It is `readOwnedCopyCounts` in `binder/ownership.ts`, and
 * it is the only one in the application.
 *
 * **Every read of the copies table here names the statuses it wants**, even where that is
 * redundant against a primary key. The reads in this file are about *history* — the purchase
 * trail, which keeps disposed rows on purpose — and the rule is uniform so that a read which says
 * nothing about status stands out as the mistake it is. `tests/ownership-filter.test.ts` holds
 * every statement the application issues to that rule, whichever module wrote it.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type {
	CopyCreateRequest,
	CopyDisposalRequest,
	CopyDocument,
	CopyPatchRequest,
} from "../../shared/copies.ts";
import { COPY_STATUSES } from "../../shared/copies.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { CopyRow, VariantPriorityRow } from "../db/schema.ts";
import { copies, corpusVariants, variantPriorities } from "../db/schema.ts";

export function toCopyDocument(row: CopyRow): CopyDocument {
	return {
		id: row.id,
		cardKey: row.cardKey,
		variantId: row.variantId,
		condition: row.condition,
		grader: row.grader,
		grade: row.grade,
		certNo: row.certNo,
		priceMinor: row.priceMinor,
		currency: row.currency,
		priceHomeMinor: row.priceHomeMinor,
		homeCurrency: row.homeCurrency,
		rateDate: row.rateDate,
		acquiredAt: row.acquiredAt,
		sourceType: row.sourceType,
		sourceNote: row.sourceNote,
		note: row.note,
		status: row.status,
		disposedAt: row.disposedAt,
		disposalKind: row.disposalKind,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** Whether the corpus actually holds this variant, by the composite identity and not by half of it. */
export function variantExists(db: GloomDatabase, cardKey: string, variantId: string): boolean {
	const row = db
		.select({ cardKey: corpusVariants.cardKey })
		.from(corpusVariants)
		.where(and(eq(corpusVariants.cardKey, cardKey), eq(corpusVariants.variantId, variantId)))
		.get();
	return row !== undefined;
}

/**
 * One copy, by the identifier the client minted for it.
 *
 * The `status in ('owned', 'disposed')` predicate is redundant against a primary key and is here
 * on purpose: **every read of this table declares which statuses it wants**, with no exceptions,
 * because a rule with one exception is a rule a reader has to check rather than one they can
 * trust. A disposed copy is still editable — a note about where it went is worth adding after the
 * fact — so what this read wants is both, and it says so.
 */
export function readCopy(db: GloomDatabase, id: string): CopyRow | null {
	return (
		db
			.select()
			.from(copies)
			.where(and(eq(copies.id, id), inArray(copies.status, [...COPY_STATUSES])))
			.get() ?? null
	);
}

/**
 * Every copy of one variant, **owned and disposed alike** — the purchase trail the sheet shows.
 *
 * The `status in ('owned', 'disposed')` predicate is not a no-op dressed as one. It is this
 * query stating which statuses it wants, which is what lets the ownership-filter test hold every
 * read of this table to the same rule: *say what you are asking for*. A query that says nothing
 * is a query that forgot, and that is the failure the criterion exists to catch.
 *
 * **Held first, then what was let go**, and oldest first within each. `status desc` rather than
 * `asc` because the two values sort `disposed` before `owned` alphabetically, and a sheet that
 * opened with the cards the owner no longer has would read as a list of losses. The order is
 * total — the identifier breaks the last tie — so two reads of an unchanged trail agree.
 */
export function readVariantCopies(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
): CopyRow[] {
	return db
		.select()
		.from(copies)
		.where(
			and(
				eq(copies.cardKey, cardKey),
				eq(copies.variantId, variantId),
				inArray(copies.status, [...COPY_STATUSES]),
			),
		)
		.orderBy(desc(copies.status), asc(copies.createdAt), asc(copies.id))
		.all();
}

/**
 * Record a copy.
 *
 * **Idempotent on the client's UUID.** A create whose response was lost — a tailnet that dropped
 * between the write and the reply — replays into this same row rather than into a second card the
 * owner does not have. `do nothing` rather than an upsert because the second request is the *same*
 * request: taking the first write as authoritative means a replay can never rewrite a copy the
 * owner has since edited from another tab.
 *
 * A copy is created `owned`. Disposal is a separate act with a separate route.
 */
export function insertCopy(
	db: GloomDatabase,
	request: CopyCreateRequest,
	now: number,
): { row: CopyRow; created: boolean } {
	const existing = readCopy(db, request.id);
	if (existing !== null) return { row: existing, created: false };

	db.insert(copies)
		.values({
			id: request.id,
			cardKey: request.cardKey,
			variantId: request.variantId,
			condition: request.condition ?? null,
			grader: request.grader ?? null,
			grade: request.grade ?? null,
			certNo: request.certNo ?? null,
			priceMinor: request.priceMinor ?? null,
			currency: request.currency ?? null,
			priceHomeMinor: request.priceHomeMinor ?? null,
			homeCurrency: request.homeCurrency ?? null,
			rateDate: request.rateDate ?? null,
			acquiredAt: request.acquiredAt ?? null,
			sourceType: request.sourceType ?? null,
			sourceNote: request.sourceNote ?? null,
			note: request.note ?? null,
			status: "owned",
			disposedAt: null,
			disposalKind: null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({ target: copies.id })
		.run();

	const row = readCopy(db, request.id);
	if (row === null) throw new Error("the copy insert wrote no row");
	return { row, created: true };
}

/**
 * Edit a copy. **An absent key leaves the field alone; an explicit `null` clears it.**
 *
 * `status`, `disposed_at` and `disposal_kind` are not writable here — a correction to a price
 * must not be able to take a card out of the collection as a side effect.
 */
export function updateCopy(
	db: GloomDatabase,
	id: string,
	patch: CopyPatchRequest,
	now: number,
): CopyRow {
	const fields: Partial<CopyRow> = {};
	if ("condition" in patch) fields.condition = patch.condition ?? null;
	if ("grader" in patch) fields.grader = patch.grader ?? null;
	if ("grade" in patch) fields.grade = patch.grade ?? null;
	if ("certNo" in patch) fields.certNo = patch.certNo ?? null;
	if ("priceMinor" in patch) fields.priceMinor = patch.priceMinor ?? null;
	if ("currency" in patch) fields.currency = patch.currency ?? null;
	if ("priceHomeMinor" in patch) fields.priceHomeMinor = patch.priceHomeMinor ?? null;
	if ("homeCurrency" in patch) fields.homeCurrency = patch.homeCurrency ?? null;
	if ("rateDate" in patch) fields.rateDate = patch.rateDate ?? null;
	if ("acquiredAt" in patch) fields.acquiredAt = patch.acquiredAt ?? null;
	if ("sourceType" in patch) fields.sourceType = patch.sourceType ?? null;
	if ("sourceNote" in patch) fields.sourceNote = patch.sourceNote ?? null;
	if ("note" in patch) fields.note = patch.note ?? null;

	db.update(copies)
		.set({ ...fields, updatedAt: now })
		.where(eq(copies.id, id))
		.run();

	const row = readCopy(db, id);
	if (row === null) throw new Error("the copy update wrote no row");
	return row;
}

/**
 * Dispose of a copy: sold, traded or lost.
 *
 * **A state change, never a delete.** The row keeps its price, its source and its note, so the
 * question "what did I pay for the one I upgraded out of" still has an answer years later.
 *
 * Disposing something already disposed leaves the first disposal's date alone. The card went once.
 */
export function disposeCopy(
	db: GloomDatabase,
	id: string,
	request: CopyDisposalRequest,
	now: number,
): CopyRow {
	const existing = readCopy(db, id);
	if (existing === null) throw new Error("no such copy");
	if (existing.status === "disposed") return existing;

	db.update(copies)
		.set({
			status: "disposed",
			disposedAt: request.disposedAt,
			disposalKind: request.disposalKind ?? null,
			note: mergeNote(existing.note, request.note ?? null),
			updatedAt: now,
		})
		.where(eq(copies.id, id))
		.run();

	const row = readCopy(db, id);
	if (row === null) throw new Error("the disposal wrote no row");
	return row;
}

/** A disposal note is appended rather than substituted; what was written at purchase still stands. */
function mergeNote(existing: string | null, addition: string | null): string | null {
	if (addition === null || addition.trim() === "") return existing;
	if (existing === null || existing.trim() === "") return addition;
	return `${existing}\n${addition}`;
}

/* -------------------------------------------------------------------------- */
/* Priorities                                                                  */
/* -------------------------------------------------------------------------- */

/** Every priority the owner has set, keyed the same composite way as everything else. */
export function readVariantPriorities(db: GloomDatabase): VariantPriorityRow[] {
	return db.select().from(variantPriorities).all();
}

export function readVariantPriority(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
): number | null {
	const row = db
		.select({ priority: variantPriorities.priority })
		.from(variantPriorities)
		.where(and(eq(variantPriorities.cardKey, cardKey), eq(variantPriorities.variantId, variantId)))
		.get();
	return row?.priority ?? null;
}

/**
 * Set or clear the dial. Last write wins — one owner, one device, and the outbox replays in order.
 *
 * Clearing **deletes the row** rather than writing a zero: `0` is a real rung on the 0–3 scale and
 * a stored zero could not be told apart from "never set". This is the one delete in the
 * collection's write path, and it removes a preference rather than a card.
 */
export function setVariantPriority(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
	priority: number | null,
	now: number,
): void {
	if (priority === null) {
		db.delete(variantPriorities)
			.where(
				and(eq(variantPriorities.cardKey, cardKey), eq(variantPriorities.variantId, variantId)),
			)
			.run();
		return;
	}

	db.insert(variantPriorities)
		.values({ cardKey, variantId, priority, updatedAt: now })
		.onConflictDoUpdate({
			target: [variantPriorities.cardKey, variantPriorities.variantId],
			set: { priority, updatedAt: now },
		})
		.run();
}
