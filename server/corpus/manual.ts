/**
 * Persistence for hand-added cards/variants and the exclusion list.
 *
 * The sync never writes these tables' owner-authored rows: `WHERE provenance <> 'manual'` on
 * every upsert, and `corpus_exclusions` is never named by a sync statement. This module is the
 * only writer. Identity is minted here from the client's UUIDs so a clone cannot inherit its
 * source's `card_key`.
 */

import { and, eq } from "drizzle-orm";
import type {
	CorpusExclusionDocument,
	ManualVariantCreateRequest,
	ManualVariantDocument,
	ManualVariantPatchRequest,
} from "../../shared/manual.ts";
import { setVariantPriority } from "../copies/repository.ts";
import type { GloomDatabase } from "../db/client.ts";
import { corpusCards, corpusExclusions, corpusVariants } from "../db/schema.ts";
import { canonicaliseAxisValue, canonicaliseStamps } from "./canonical.ts";
import { MANUAL_NAMESPACE, manualCardKey, manualVariantId } from "./tcgdex.ts";

export class InvalidManualError extends Error {
	readonly status: 400 | 404 | 409;

	constructor(message: string, status: 400 | 404 | 409 = 400) {
		super(message);
		this.name = "InvalidManualError";
		this.status = status;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(body: unknown, what: string): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidManualError(`${what} must be a JSON object`);
	}
	return body as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidManualError(`${field} is required and must be a non-empty string`);
	}
	return value.trim();
}

function requiredUuid(value: unknown, field: string): string {
	const id = requiredString(value, field);
	if (!UUID.test(id)) {
		throw new InvalidManualError(`${field} must be a UUID minted by the client`);
	}
	return id;
}

function optionalText(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw new InvalidManualError(`${field} must be a string`);
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

function optionalAxis(
	value: unknown,
	axis: "finish" | "subtype" | "foil" | "size",
	field: string,
): string | null {
	const raw = optionalText(value, field);
	if (raw === null) return null;
	return canonicaliseAxisValue(axis, raw);
}

function optionalStamps(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (value === null) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new InvalidManualError("stamps must be a list of strings");
	}
	return canonicaliseStamps(value);
}

function parseLanguage(value: unknown): string {
	const language = requiredString(value, "language");
	if (language === MANUAL_NAMESPACE) {
		// `manual` is the reserved identity prefix, not a language the owner can collect in.
		throw new InvalidManualError(
			`language cannot be "${MANUAL_NAMESPACE}" — that namespace is reserved for identities`,
		);
	}
	return language;
}

export function parseManualCreateRequest(body: unknown): ManualVariantCreateRequest {
	const raw = asRecord(body, "a hand-added variant");
	return {
		id: requiredUuid(raw.id, "id"),
		variantId: requiredUuid(raw.variantId, "variantId"),
		language: parseLanguage(raw.language),
		setId: requiredString(raw.setId, "setId"),
		setName: optionalText(raw.setName, "setName"),
		localId: requiredString(raw.localId, "localId"),
		name: requiredString(raw.name, "name"),
		rarity: optionalText(raw.rarity, "rarity"),
		finish: optionalAxis(raw.finish, "finish", "finish"),
		subtype: optionalAxis(raw.subtype, "subtype", "subtype"),
		stamps: optionalStamps(raw.stamps) ?? [],
		foil: optionalAxis(raw.foil, "foil", "foil"),
		size: optionalAxis(raw.size, "size", "size"),
	};
}

export function parseManualPatchRequest(body: unknown): ManualVariantPatchRequest {
	const raw = asRecord(body, "a hand-added variant edit");
	return {
		...("language" in raw ? { language: parseLanguage(raw.language) } : {}),
		...("setId" in raw ? { setId: requiredString(raw.setId, "setId") } : {}),
		...("setName" in raw ? { setName: optionalText(raw.setName, "setName") } : {}),
		...("localId" in raw ? { localId: requiredString(raw.localId, "localId") } : {}),
		...("name" in raw ? { name: requiredString(raw.name, "name") } : {}),
		...("rarity" in raw ? { rarity: optionalText(raw.rarity, "rarity") } : {}),
		...("finish" in raw ? { finish: optionalAxis(raw.finish, "finish", "finish") } : {}),
		...("subtype" in raw ? { subtype: optionalAxis(raw.subtype, "subtype", "subtype") } : {}),
		...("stamps" in raw ? { stamps: optionalStamps(raw.stamps) ?? [] } : {}),
		...("foil" in raw ? { foil: optionalAxis(raw.foil, "foil", "foil") } : {}),
		...("size" in raw ? { size: optionalAxis(raw.size, "size", "size") } : {}),
	};
}

export function parseExclusionUpsert(body: unknown): { cardKey: string; reason: string | null } {
	const raw = asRecord(body, "an exclusion");
	return {
		cardKey: requiredString(raw.cardKey, "cardKey"),
		reason: optionalText(raw.reason, "reason"),
	};
}

function isUniqueConstraint(cause: unknown): boolean {
	return cause instanceof Error && /UNIQUE constraint failed/i.test(cause.message);
}

function isForeignKeyConstraint(cause: unknown): boolean {
	return cause instanceof Error && /FOREIGN KEY constraint failed/i.test(cause.message);
}

function parseStamps(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

export function toManualVariantDocument(
	card: typeof corpusCards.$inferSelect,
	variant: typeof corpusVariants.$inferSelect,
): ManualVariantDocument {
	return {
		cardKey: card.cardKey,
		variantId: variant.variantId,
		language: card.language,
		setId: card.setId,
		setName: card.setName,
		localId: card.localId,
		name: card.name,
		rarity: card.rarity,
		finish: variant.finish,
		subtype: variant.subtype,
		stamps: parseStamps(variant.stamps),
		foil: variant.foil,
		size: variant.size,
		provenance: "manual",
	};
}

export function readManualVariant(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
): ManualVariantDocument | null {
	const card = db.select().from(corpusCards).where(eq(corpusCards.cardKey, cardKey)).get();
	const variant = db
		.select()
		.from(corpusVariants)
		.where(and(eq(corpusVariants.cardKey, cardKey), eq(corpusVariants.variantId, variantId)))
		.get();
	if (card === undefined || variant === undefined) return null;
	if (card.provenance !== "manual" || variant.provenance !== "manual") return null;
	return toManualVariantDocument(card, variant);
}

/**
 * Insert a hand-added card and variant. Identity is always `manual:{uuid}` for both halves —
 * the request's display fields are copied, never the source's keys.
 *
 * Idempotent on the pair of client UUIDs: a replay of the same create answers with the row
 * already held, the same contract the copies create uses so the outbox can land twice.
 */
export function insertManualVariant(
	db: GloomDatabase,
	request: ManualVariantCreateRequest,
	now: number,
): { document: ManualVariantDocument; created: boolean } {
	const cardKey = manualCardKey(request.id);
	const variantId = manualVariantId(request.variantId);

	const existing = readManualVariant(db, cardKey, variantId);
	if (existing !== null) return { document: existing, created: false };

	const existingCard = db.select().from(corpusCards).where(eq(corpusCards.cardKey, cardKey)).get();
	if (existingCard !== undefined) {
		throw new InvalidManualError("that card already exists with a different variant", 409);
	}

	try {
		db.transaction((tx) => {
			tx.insert(corpusCards)
				.values({
					cardKey,
					language: request.language,
					cardId: request.id,
					setId: request.setId,
					setName: request.setName ?? null,
					localId: request.localId,
					name: request.name,
					rarity: request.rarity ?? null,
					dexIds: "[]",
					membershipReason: "name",
					provenance: "manual",
					missingUpstream: 0,
					firstSeenAt: now,
					lastSyncedAt: now,
				})
				.run();
			tx.insert(corpusVariants)
				.values({
					cardKey,
					variantId,
					finish: request.finish ?? null,
					subtype: request.subtype ?? null,
					stamps: JSON.stringify(request.stamps ?? []),
					foil: request.foil ?? null,
					size: request.size ?? null,
					provenance: "manual",
					missingUpstream: 0,
					firstSeenAt: now,
					lastSyncedAt: now,
				})
				.run();
		});
	} catch (cause) {
		if (isUniqueConstraint(cause)) {
			throw new InvalidManualError(
				"a card with that language, set and number already exists — change one of them",
				409,
			);
		}
		throw cause;
	}

	const created = readManualVariant(db, cardKey, variantId);
	if (created === null) throw new Error("the hand-added insert wrote no row");
	return { document: created, created: true };
}

export function updateManualVariant(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
	patch: ManualVariantPatchRequest,
	now: number,
): ManualVariantDocument {
	const existing = readManualVariant(db, cardKey, variantId);
	if (existing === null) {
		const card = db.select().from(corpusCards).where(eq(corpusCards.cardKey, cardKey)).get();
		if (card !== undefined && card.provenance !== "manual") {
			throw new InvalidManualError("only a hand-added row can be edited");
		}
		throw new InvalidManualError("no such hand-added variant", 404);
	}

	try {
		db.transaction((tx) => {
			const cardPatch: Partial<typeof corpusCards.$inferInsert> = { lastSyncedAt: now };
			if (patch.language !== undefined) cardPatch.language = patch.language;
			if (patch.setId !== undefined) cardPatch.setId = patch.setId;
			if (patch.setName !== undefined) cardPatch.setName = patch.setName;
			if (patch.localId !== undefined) cardPatch.localId = patch.localId;
			if (patch.name !== undefined) cardPatch.name = patch.name;
			if (patch.rarity !== undefined) cardPatch.rarity = patch.rarity;
			tx.update(corpusCards).set(cardPatch).where(eq(corpusCards.cardKey, cardKey)).run();

			const variantPatch: Partial<typeof corpusVariants.$inferInsert> = { lastSyncedAt: now };
			if (patch.finish !== undefined) variantPatch.finish = patch.finish;
			if (patch.subtype !== undefined) variantPatch.subtype = patch.subtype;
			if (patch.stamps !== undefined) variantPatch.stamps = JSON.stringify(patch.stamps);
			if (patch.foil !== undefined) variantPatch.foil = patch.foil;
			if (patch.size !== undefined) variantPatch.size = patch.size;
			tx.update(corpusVariants)
				.set(variantPatch)
				.where(and(eq(corpusVariants.cardKey, cardKey), eq(corpusVariants.variantId, variantId)))
				.run();
		});
	} catch (cause) {
		if (isUniqueConstraint(cause)) {
			throw new InvalidManualError(
				"a card with that language, set and number already exists — change one of them",
				409,
			);
		}
		throw cause;
	}

	const updated = readManualVariant(db, cardKey, variantId);
	if (updated === null) throw new Error("the hand-added update wrote no row");
	return updated;
}

/**
 * Delete a hand-added variant, and its card if that was the last printing.
 *
 * A copy pointing at it is a reason to refuse, not a reason to cascade: the purchase trail
 * belongs to the copies ticket and there is no delete for a copy. A leftover priority is a
 * preference and is cleared first so the foreign key does not keep a row the owner asked to
 * remove.
 */
export function deleteManualVariant(
	db: GloomDatabase,
	cardKey: string,
	variantId: string,
	now: number,
): void {
	const existing = readManualVariant(db, cardKey, variantId);
	if (existing === null) {
		const card = db.select().from(corpusCards).where(eq(corpusCards.cardKey, cardKey)).get();
		if (card !== undefined && card.provenance !== "manual") {
			throw new InvalidManualError("only a hand-added row can be deleted");
		}
		throw new InvalidManualError("no such hand-added variant", 404);
	}

	setVariantPriority(db, cardKey, variantId, null, now);

	try {
		db.transaction((tx) => {
			tx.delete(corpusVariants)
				.where(and(eq(corpusVariants.cardKey, cardKey), eq(corpusVariants.variantId, variantId)))
				.run();
			const remaining = tx
				.select({ variantId: corpusVariants.variantId })
				.from(corpusVariants)
				.where(eq(corpusVariants.cardKey, cardKey))
				.all();
			if (remaining.length === 0) {
				tx.delete(corpusCards).where(eq(corpusCards.cardKey, cardKey)).run();
			}
		});
	} catch (cause) {
		if (isForeignKeyConstraint(cause)) {
			throw new InvalidManualError(
				"a copy still points at this variant — dispose the copy before deleting the row",
				409,
			);
		}
		throw cause;
	}
}

export function readExclusionsList(db: GloomDatabase): CorpusExclusionDocument[] {
	return db
		.select()
		.from(corpusExclusions)
		.all()
		.map((row) => ({
			cardKey: row.cardKey,
			reason: row.reason,
			createdAt: row.createdAt,
		}))
		.sort((a, b) => (a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0));
}

export function upsertExclusion(
	db: GloomDatabase,
	cardKey: string,
	reason: string | null,
	now: number,
): CorpusExclusionDocument {
	db.insert(corpusExclusions)
		.values({ cardKey, reason, createdAt: now })
		.onConflictDoUpdate({
			target: corpusExclusions.cardKey,
			set: { reason },
		})
		.run();
	const row = db.select().from(corpusExclusions).where(eq(corpusExclusions.cardKey, cardKey)).get();
	if (row === undefined) throw new Error("the exclusion upsert wrote no row");
	return { cardKey: row.cardKey, reason: row.reason, createdAt: row.createdAt };
}

export function deleteExclusion(db: GloomDatabase, cardKey: string): boolean {
	db.delete(corpusExclusions).where(eq(corpusExclusions.cardKey, cardKey)).run();
	const remaining = db
		.select({ cardKey: corpusExclusions.cardKey })
		.from(corpusExclusions)
		.where(eq(corpusExclusions.cardKey, cardKey))
		.get();
	return remaining === undefined;
}
