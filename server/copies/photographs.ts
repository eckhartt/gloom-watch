/**
 * Reading and writing owner photographs. No HTTP and no image processing — the SQL lives here
 * so there is one place to look for what touches the blobs.
 *
 * **A photograph can be deleted.** That is the difference from a copy: a copy is a purchase
 * record and disposal keeps the row; a photograph is a file the owner can replace. The delete
 * is the only DELETE in the collection, and it is on this table, not on `copies`.
 *
 * This module does not import the `copies` table. Existence of the parent copy is checked
 * through `readCopy`, which already names the statuses it wants.
 */

import { asc, eq } from "drizzle-orm";
import type { PhotographDocument } from "../../shared/copies.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { CopyPhotographRow } from "../db/schema.ts";
import { copyPhotographs } from "../db/schema.ts";
import type { ProcessedPhotograph } from "./process-photograph.ts";
import { PHOTOGRAPH_CONTENT_TYPE } from "./process-photograph.ts";
import { readCopy } from "./repository.ts";

export function toPhotographDocument(row: CopyPhotographRow): PhotographDocument {
	return {
		id: row.id,
		copyId: row.copyId,
		contentType: row.imageContentType,
		byteSize: row.imageByteSize,
		width: row.width,
		height: row.height,
		createdAt: row.createdAt,
	};
}

export function copyExists(db: GloomDatabase, copyId: string): boolean {
	return readCopy(db, copyId) !== null;
}

export function readPhotograph(db: GloomDatabase, id: string): CopyPhotographRow | null {
	return db.select().from(copyPhotographs).where(eq(copyPhotographs.id, id)).get() ?? null;
}

export function readCopyPhotographs(db: GloomDatabase, copyId: string): CopyPhotographRow[] {
	return db
		.select()
		.from(copyPhotographs)
		.where(eq(copyPhotographs.copyId, copyId))
		.orderBy(asc(copyPhotographs.createdAt), asc(copyPhotographs.id))
		.all();
}

/**
 * Attach a processed photograph.
 *
 * **Idempotent on the client's UUID.** A create whose response was lost replays into this same
 * row rather than a second image. `do nothing` rather than an upsert because the second request
 * is the same request: taking the first write as authoritative means a replay cannot replace a
 * photograph the owner has since looked at.
 */
export function insertPhotograph(
	db: GloomDatabase,
	input: {
		readonly id: string;
		readonly copyId: string;
		readonly processed: ProcessedPhotograph;
	},
	now: number,
): { row: CopyPhotographRow; created: boolean } {
	const existing = readPhotograph(db, input.id);
	if (existing !== null) return { row: existing, created: false };

	db.insert(copyPhotographs)
		.values({
			id: input.id,
			copyId: input.copyId,
			imageBytes: input.processed.bytes,
			imageByteSize: input.processed.bytes.byteLength,
			imageContentType: PHOTOGRAPH_CONTENT_TYPE,
			width: input.processed.width,
			height: input.processed.height,
			createdAt: now,
		})
		.onConflictDoNothing({ target: copyPhotographs.id })
		.run();

	const row = readPhotograph(db, input.id);
	if (row === null) throw new Error("the photograph insert wrote no row");
	return { row, created: true };
}

export function deletePhotograph(db: GloomDatabase, id: string): boolean {
	if (readPhotograph(db, id) === null) return false;
	db.delete(copyPhotographs).where(eq(copyPhotographs.id, id)).run();
	return true;
}
