/**
 * Owner-authored aliases. The matcher takes these as an argument; this is the table
 * that produces that argument.
 *
 * Teaching the same phrase twice updates the target. That is how a confirm replay and
 * a second listing with the same wording stay one mapping.
 */

import { and, asc, eq } from "drizzle-orm";
import type { MatcherAlias } from "../../shared/matcher.ts";
import type { AliasDocument, AliasPatchRequest } from "../../shared/queue.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { AliasRow } from "../db/schema.ts";
import { aliases, corpusCards, corpusVariants } from "../db/schema.ts";

export function toAliasDocument(row: AliasRow): AliasDocument {
	return {
		id: row.id,
		phrase: row.phrase,
		cardKey: row.cardKey,
		variantId: row.variantId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function toMatcherAlias(row: AliasRow): MatcherAlias {
	return {
		phrase: row.phrase,
		cardKey: row.cardKey,
		variantId: row.variantId,
	};
}

export function readAlias(db: GloomDatabase, id: string): AliasRow | null {
	return db.select().from(aliases).where(eq(aliases.id, id)).get() ?? null;
}

export function readAliasByPhrase(db: GloomDatabase, phrase: string): AliasRow | null {
	return db.select().from(aliases).where(eq(aliases.phrase, phrase)).get() ?? null;
}

export function readAliases(db: GloomDatabase): AliasRow[] {
	return db.select().from(aliases).orderBy(asc(aliases.phrase), asc(aliases.id)).all();
}

export function loadMatcherAliases(db: GloomDatabase): MatcherAlias[] {
	return readAliases(db).map(toMatcherAlias);
}

export function cardExists(db: GloomDatabase, cardKey: string): boolean {
	const row = db
		.select({ cardKey: corpusCards.cardKey })
		.from(corpusCards)
		.where(eq(corpusCards.cardKey, cardKey))
		.get();
	return row !== undefined;
}

export function cardHasVariant(db: GloomDatabase, cardKey: string, variantId: string): boolean {
	const row = db
		.select({ variantId: corpusVariants.variantId })
		.from(corpusVariants)
		.where(and(eq(corpusVariants.cardKey, cardKey), eq(corpusVariants.variantId, variantId)))
		.get();
	return row !== undefined;
}

export function insertAlias(
	db: GloomDatabase,
	request: {
		readonly id: string;
		readonly phrase: string;
		readonly cardKey: string;
		readonly variantId: string | null;
	},
	now: number,
): { row: AliasRow; created: boolean } {
	const existing = readAlias(db, request.id);
	if (existing !== null) return { row: existing, created: false };

	db.insert(aliases)
		.values({
			id: request.id,
			phrase: request.phrase,
			cardKey: request.cardKey,
			variantId: request.variantId,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({ target: aliases.id })
		.run();

	const row = readAlias(db, request.id);
	if (row === null) throw new Error("the alias insert wrote no row");
	return { row, created: true };
}

/**
 * Teach a phrase. Same wording lands in one row: a new id if unseen, otherwise the
 * existing mapping is retargeted. Confirming twice must not stack aliases.
 */
export function upsertAliasByPhrase(
	db: GloomDatabase,
	request: {
		readonly id: string;
		readonly phrase: string;
		readonly cardKey: string;
		readonly variantId: string | null;
	},
	now: number,
): { row: AliasRow; created: boolean } {
	const byPhrase = readAliasByPhrase(db, request.phrase);
	if (byPhrase !== null) {
		if (byPhrase.cardKey === request.cardKey && byPhrase.variantId === request.variantId) {
			return { row: byPhrase, created: false };
		}
		db.update(aliases)
			.set({
				cardKey: request.cardKey,
				variantId: request.variantId,
				updatedAt: now,
			})
			.where(eq(aliases.id, byPhrase.id))
			.run();
		const row = readAlias(db, byPhrase.id);
		if (row === null) throw new Error("the alias retarget wrote no row");
		return { row, created: false };
	}

	return insertAlias(db, request, now);
}

export function updateAlias(
	db: GloomDatabase,
	id: string,
	patch: AliasPatchRequest,
	now: number,
): AliasRow {
	const fields: Partial<AliasRow> = {};
	if (patch.phrase !== undefined) fields.phrase = patch.phrase;
	if (patch.cardKey !== undefined) fields.cardKey = patch.cardKey;
	if ("variantId" in patch) fields.variantId = patch.variantId ?? null;

	db.update(aliases)
		.set({ ...fields, updatedAt: now })
		.where(eq(aliases.id, id))
		.run();

	const row = readAlias(db, id);
	if (row === null) throw new Error("the alias update wrote no row");
	return row;
}

export function deleteAlias(db: GloomDatabase, id: string): boolean {
	const existing = readAlias(db, id);
	if (existing === null) return false;
	db.delete(aliases).where(eq(aliases.id, id)).run();
	return true;
}
