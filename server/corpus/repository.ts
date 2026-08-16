/**
 * Every read and write the corpus tables need. Kept apart from the sync so the job reads as a
 * sequence of phases and the SQL lives in one place.
 */

import { and, count, eq, inArray, isNotNull, isNull, ne, type SQL, sql, sum } from "drizzle-orm";
import type { GloomDatabase } from "../db/client.ts";
import type { CorpusSetRow } from "../db/schema.ts";
import {
	corpusBrief,
	corpusCards,
	corpusExclusions,
	corpusSets,
	corpusSyncJobs,
	corpusVariants,
} from "../db/schema.ts";
import type { NormalisedCard } from "./ingest.ts";
import { type BriefRecord, setKeyFor } from "./membership.ts";

/** SQLite's parameter ceiling is per statement, so bulk inserts go in chunks. */
const INSERT_CHUNK = 400;

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
	return chunks;
}

/** Anything that can answer a scalar query — the database or a transaction on it. */
interface SqlReader {
	get<T>(query: SQL): T;
}

/**
 * Rows written by the statement just executed on this connection.
 *
 * Drizzle's `bun-sqlite` driver types every `.run()` as `void` and discards the result, so
 * SQLite's own `changes()` is the way to tell an upsert that wrote from one the `provenance <>
 * 'manual'` guard skipped. `changes()` is untouched by SELECT, so reading it here is safe.
 *
 * The row comes back **positionally**: `db.get()` on raw SQL returns `[1]`, not
 * `{ changes: 1 }`, whatever the column is aliased to.
 */
function rowsChanged(runner: SqlReader): number {
	const row = runner.get<unknown>(sql`select changes()`);
	if (Array.isArray(row)) return Number(row[0] ?? 0);
	if (typeof row === "object" && row !== null && "changes()" in row) {
		return Number((row as Record<string, unknown>)["changes()"] ?? 0);
	}
	return 0;
}

export interface BriefUpsert {
	readonly cardId: string;
	readonly localId: string;
	readonly name: string;
	readonly dexIds: readonly number[];
	readonly imageBase: string | null;
}

/**
 * Replace one language's brief snapshot.
 *
 * Delete-then-insert, in a transaction, and deliberately unlike every other table here: this is
 * a **cache of upstream's index**, not owner data and not the masterset. Leaving a stale record
 * behind would keep a card in the membership set after upstream removed it, and phase 2 would
 * chase a 404 forever. The no-delete rule protects `corpus_cards` and `corpus_variants`, which
 * is where ownership points.
 */
export function replaceBriefSnapshot(
	db: GloomDatabase,
	language: string,
	records: readonly BriefUpsert[],
	now: number,
): void {
	const rows = records.map((record) => ({
		language,
		cardId: record.cardId,
		localId: record.localId,
		name: record.name,
		dexIds: JSON.stringify(record.dexIds),
		imageBase: record.imageBase,
		syncedAt: now,
	}));

	db.transaction((tx) => {
		tx.delete(corpusBrief).where(eq(corpusBrief.language, language)).run();
		for (const batch of chunk(rows, INSERT_CHUNK)) {
			tx.insert(corpusBrief).values(batch).run();
		}
	});
}

export function readBriefRecords(db: GloomDatabase): BriefRecord[] {
	return db
		.select()
		.from(corpusBrief)
		.all()
		.map((row) => ({
			language: row.language,
			cardId: row.cardId,
			localId: row.localId,
			name: row.name,
			dexIds: parseNumberArray(row.dexIds),
		}));
}

function parseNumberArray(raw: string): number[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
	} catch {
		return [];
	}
}

export function readExclusions(db: GloomDatabase): Set<string> {
	return new Set(
		db
			.select({ cardKey: corpusExclusions.cardKey })
			.from(corpusExclusions)
			.all()
			.map((row) => row.cardKey),
	);
}

export interface UpsertCounts {
	cards: number;
	variants: number;
}

/**
 * Write one card and its variants.
 *
 * Three rules hold here and each has cost the project a decision:
 *
 * - **The upsert key is `(card_key)` for the card and `(card_key, variant_id)` for the variant.**
 *   The composite is the primary key, so `variant_id` alone cannot be used by accident.
 * - **A `manual` row is never touched.** `WHERE provenance <> 'manual'` on the update half of
 *   every upsert, so a Korean printing the owner typed by hand survives a sync that happens to
 *   mint the same identity.
 * - **Nothing is deleted and nothing is renumbered.** Re-appearing after an absence clears the
 *   `missing_upstream` flag rather than recreating the row, so a copy pointing at it still
 *   resolves.
 */
export function upsertCard(db: GloomDatabase, card: NormalisedCard, now: number): UpsertCounts {
	const counts: UpsertCounts = { cards: 0, variants: 0 };

	db.transaction((tx) => {
		tx.insert(corpusCards)
			.values({
				cardKey: card.cardKey,
				language: card.language,
				cardId: card.cardId,
				setId: card.setId,
				setName: card.setName,
				localId: card.localId,
				name: card.name,
				category: card.category,
				rarity: card.rarity,
				dexIds: JSON.stringify(card.dexIds),
				membershipReason: card.membershipReason,
				imageBase: card.imageBase,
				imageSeries: card.imageSeries,
				provenance: "tcgdex",
				missingUpstream: 0,
				firstSeenAt: now,
				lastSyncedAt: now,
			})
			.onConflictDoUpdate({
				target: corpusCards.cardKey,
				set: {
					setId: sql`excluded.set_id`,
					setName: sql`excluded.set_name`,
					localId: sql`excluded.local_id`,
					name: sql`excluded.name`,
					category: sql`excluded.category`,
					rarity: sql`excluded.rarity`,
					dexIds: sql`excluded.dex_ids`,
					membershipReason: sql`excluded.membership_reason`,
					imageBase: sql`excluded.image_base`,
					imageSeries: sql`excluded.image_series`,
					// Back from the dead: clear the flag, keep the row and its identity.
					missingUpstream: sql`0`,
					missingSince: sql`NULL`,
					lastSyncedAt: sql`excluded.last_synced_at`,
				},
				setWhere: ne(corpusCards.provenance, "manual"),
			})
			.run();
		counts.cards += rowsChanged(tx) > 0 ? 1 : 0;

		for (const variant of card.variants) {
			tx.insert(corpusVariants)
				.values({
					cardKey: variant.cardKey,
					variantId: variant.variantId,
					finish: variant.finish,
					subtype: variant.subtype,
					stamps: JSON.stringify(variant.stamps),
					foil: variant.foil,
					size: variant.size,
					upstreamRaw: variant.upstreamRaw,
					provenance: "tcgdex",
					missingUpstream: 0,
					firstSeenAt: now,
					lastSyncedAt: now,
				})
				.onConflictDoUpdate({
					target: [corpusVariants.cardKey, corpusVariants.variantId],
					set: {
						finish: sql`excluded.finish`,
						subtype: sql`excluded.subtype`,
						stamps: sql`excluded.stamps`,
						foil: sql`excluded.foil`,
						size: sql`excluded.size`,
						upstreamRaw: sql`excluded.upstream_raw`,
						missingUpstream: sql`0`,
						missingSince: sql`NULL`,
						lastSyncedAt: sql`excluded.last_synced_at`,
					},
					setWhere: ne(corpusVariants.provenance, "manual"),
				})
				.run();
			counts.variants += rowsChanged(tx) > 0 ? 1 : 0;
		}
	});

	return counts;
}

export interface ImageWrite {
	readonly cardKey: string;
	readonly hash: string;
	readonly bytes: Uint8Array;
	readonly contentType: string;
}

export function writeCardImage(db: GloomDatabase, image: ImageWrite, now: number): void {
	db.update(corpusCards)
		.set({
			imageHash: image.hash,
			imageBytes: Buffer.from(image.bytes),
			imageByteSize: image.bytes.byteLength,
			imageContentType: image.contentType,
			imageFetchedAt: now,
		})
		.where(and(eq(corpusCards.cardKey, image.cardKey), ne(corpusCards.provenance, "manual")))
		.run();
}

export interface ImageCandidate {
	readonly cardKey: string;
	readonly language: string;
	readonly imageBase: string;
	readonly imageHash: string | null;
	readonly hasBytes: boolean;
}

/** Cards with an upstream image, and whether we already hold bytes for the current hash. */
export function readImageCandidates(
	db: GloomDatabase,
	languages: readonly string[],
): ImageCandidate[] {
	if (languages.length === 0) return [];
	return db
		.select({
			cardKey: corpusCards.cardKey,
			language: corpusCards.language,
			imageBase: corpusCards.imageBase,
			imageHash: corpusCards.imageHash,
			byteSize: corpusCards.imageByteSize,
		})
		.from(corpusCards)
		.where(
			and(
				isNotNull(corpusCards.imageBase),
				ne(corpusCards.provenance, "manual"),
				inArray(corpusCards.language, [...languages]),
			),
		)
		.all()
		.flatMap((row) =>
			row.imageBase === null
				? []
				: [
						{
							cardKey: row.cardKey,
							language: row.language,
							imageBase: row.imageBase,
							imageHash: row.imageHash,
							hasBytes: (row.byteSize ?? 0) > 0,
						},
					],
		);
}

/* -------------------------------------------------------------------------- */
/* Sets                                                                        */
/* -------------------------------------------------------------------------- */

export interface SetFetchTarget {
	readonly setKey: string;
	readonly language: string;
	readonly setId: string;
}

export interface SetFetchPlan {
	/** Sets to ask upstream about this run. */
	readonly wanted: readonly SetFetchTarget[];
	/** Sets the corpus references and already holds a date for. Nothing is fetched for these. */
	readonly satisfied: number;
}

/**
 * Which sets this sync needs to ask upstream about.
 *
 * **A set release date is a historical fact that does not change**, so a set already held with a
 * date is never re-fetched. That is what makes this phase incremental in the only way it can be:
 * there is no hash manifest and no conditional-fetch story for `/v2/{lang}/sets/{setId}`, so the
 * cheapest correct request is the one not sent. A first sync asks about every `(language,
 * set_id)` pair the corpus references — 137 against the live corpus, not 46 × 11 — and a
 * re-sync of an unchanged corpus asks about none.
 *
 * Three states are re-asked, because each means the fact we came for is missing:
 *
 * - no row at all — a set that appeared since the last sync, or a sync interrupted part way
 *   through this phase, which is what makes it **resumable**: the rows already written stand and
 *   the next run picks up the remainder;
 * - a row with no `release_date` — a fetch that succeeded but carried no date, retried in case
 *   upstream fills it in later;
 * - a row flagged `missing_upstream` — retried, because a 404 may have been upstream's mistake.
 *
 * Scoped to the languages whose detail phase completed, for the same reason the image phase is:
 * a language whose fetch failed should not have its sets chased or flagged.
 */
export function planSetFetches(db: GloomDatabase, languages: readonly string[]): SetFetchPlan {
	if (languages.length === 0) return { wanted: [], satisfied: 0 };

	const referenced = db
		.selectDistinct({ language: corpusCards.language, setId: corpusCards.setId })
		.from(corpusCards)
		.where(and(ne(corpusCards.provenance, "manual"), inArray(corpusCards.language, [...languages])))
		.all();

	const held = new Map(
		db
			.select({
				setKey: corpusSets.setKey,
				releaseDate: corpusSets.releaseDate,
				missingUpstream: corpusSets.missingUpstream,
			})
			.from(corpusSets)
			.all()
			.map((row) => [row.setKey, row]),
	);

	const wanted: SetFetchTarget[] = [];
	let satisfied = 0;
	for (const row of referenced) {
		const setKey = setKeyFor(row.language, row.setId);
		const existing = held.get(setKey);
		if (existing !== undefined && existing.releaseDate !== null && existing.missingUpstream === 0) {
			satisfied++;
			continue;
		}
		wanted.push({ setKey, language: row.language, setId: row.setId });
	}
	return { wanted, satisfied };
}

export interface SetUpsert {
	readonly setKey: string;
	readonly language: string;
	readonly setId: string;
	readonly name: string | null;
	/** ISO `YYYY-MM-DD`, or null. Never an epoch. */
	readonly releaseDate: string | null;
	readonly serieId: string | null;
	readonly serieName: string | null;
	readonly abbreviation: string | null;
	readonly cardCountTotal: number | null;
}

/** Same rules as `upsertCard`: keyed on identity, never deletes, never touches a manual row. */
export function upsertSet(db: GloomDatabase, set: SetUpsert, now: number): void {
	db.insert(corpusSets)
		.values({
			...set,
			provenance: "tcgdex",
			missingUpstream: 0,
			firstSeenAt: now,
			lastSyncedAt: now,
		})
		.onConflictDoUpdate({
			target: corpusSets.setKey,
			set: {
				name: sql`excluded.name`,
				releaseDate: sql`excluded.release_date`,
				serieId: sql`excluded.serie_id`,
				serieName: sql`excluded.serie_name`,
				abbreviation: sql`excluded.abbreviation`,
				cardCountTotal: sql`excluded.card_count_total`,
				// Back from the dead, exactly as a card or a variant is.
				missingUpstream: sql`0`,
				missingSince: sql`NULL`,
				lastSyncedAt: sql`excluded.last_synced_at`,
			},
			setWhere: ne(corpusSets.provenance, "manual"),
		})
		.run();
}

/**
 * A set upstream answered 404 for: **flagged, never deleted**, and a placeholder row is written
 * when there was nothing to flag.
 *
 * The row matters even empty. Cards point at this set and the binder orders on its date, so the
 * absence has to be visible as data rather than as a missing join — and without a row the next
 * sync would have no record that the question was already asked and answered with a 404.
 */
export function flagSetMissingUpstream(
	db: GloomDatabase,
	target: SetFetchTarget,
	now: number,
): void {
	db.insert(corpusSets)
		.values({
			setKey: target.setKey,
			language: target.language,
			setId: target.setId,
			provenance: "tcgdex",
			missingUpstream: 1,
			missingSince: now,
			firstSeenAt: now,
			lastSyncedAt: now,
		})
		.onConflictDoUpdate({
			target: corpusSets.setKey,
			set: {
				missingUpstream: sql`1`,
				// Kept from the first time it vanished, so the stamp says when, not when last seen.
				missingSince: sql`coalesce(${corpusSets.missingSince}, excluded.missing_since)`,
				lastSyncedAt: sql`excluded.last_synced_at`,
			},
			setWhere: ne(corpusSets.provenance, "manual"),
		})
		.run();
}

/**
 * Every set row, unfiltered. 137 against the live corpus, so the binder reads them all and
 * indexes them in memory rather than joining on a concatenation of two columns.
 */
export function readSets(db: GloomDatabase): CorpusSetRow[] {
	return db.select().from(corpusSets).all();
}

export interface MissingFlagCounts {
	readonly cards: number;
	readonly variants: number;
}

/**
 * Flag what upstream no longer carries — **and never delete it**.
 *
 * This is the load-bearing half of re-import safety. A silent deletion removes a row from the
 * completion denominator, which makes the percentage go *up*, with every test still green. The
 * flag keeps the row, keeps any copy pointing at it, and leaves the spec's completion rule free
 * to decide what the denominator does with it.
 *
 * Scoped to `languages` — the languages this sync actually completed. A language whose fetch
 * failed must not have its whole corpus flagged as vanished.
 */
export function flagMissingUpstream(
	db: GloomDatabase,
	languages: readonly string[],
	seenCardKeys: ReadonlySet<string>,
	seenVariantKeys: ReadonlySet<string>,
	now: number,
): MissingFlagCounts {
	if (languages.length === 0) return { cards: 0, variants: 0 };

	let cards = 0;
	let variants = 0;

	db.transaction((tx) => {
		const cardRows = tx
			.select({ cardKey: corpusCards.cardKey })
			.from(corpusCards)
			.where(
				and(
					inArray(corpusCards.language, [...languages]),
					ne(corpusCards.provenance, "manual"),
					eq(corpusCards.missingUpstream, 0),
				),
			)
			.all();

		for (const row of cardRows) {
			if (seenCardKeys.has(row.cardKey)) continue;
			tx.update(corpusCards)
				.set({ missingUpstream: 1, missingSince: now })
				.where(eq(corpusCards.cardKey, row.cardKey))
				.run();
			cards++;
		}

		const variantRows = tx
			.select({ cardKey: corpusVariants.cardKey, variantId: corpusVariants.variantId })
			.from(corpusVariants)
			.innerJoin(corpusCards, eq(corpusCards.cardKey, corpusVariants.cardKey))
			.where(
				and(
					inArray(corpusCards.language, [...languages]),
					ne(corpusVariants.provenance, "manual"),
					eq(corpusVariants.missingUpstream, 0),
				),
			)
			.all();

		for (const row of variantRows) {
			if (seenVariantKeys.has(variantKeyOf(row.cardKey, row.variantId))) continue;
			tx.update(corpusVariants)
				.set({ missingUpstream: 1, missingSince: now })
				.where(
					and(eq(corpusVariants.cardKey, row.cardKey), eq(corpusVariants.variantId, row.variantId)),
				)
				.run();
			variants++;
		}
	});

	return { cards, variants };
}

/**
 * The in-memory key for "this (card, variant) was seen upstream this sync". A separator that
 * cannot occur in either half would be nice; ` ` is one, and neither a TCGdex card ID nor a
 * variant token can contain it.
 */
export function variantKeyOf(cardKey: string, variantId: string): string {
	return `${cardKey} ${variantId}`;
}

export interface CorpusTotals {
	readonly cards: number;
	readonly variants: number;
	readonly variantsMissingUpstream: number;
	readonly languages: number;
	readonly sets: number;
	/** Sets held with no release date — the binder orders these last, so the count is worth seeing. */
	readonly setsWithoutReleaseDate: number;
	readonly imagesStored: number;
	readonly imageBytes: number;
}

export function readCorpusTotals(db: GloomDatabase): CorpusTotals {
	const cards = db.select({ value: count() }).from(corpusCards).get()?.value ?? 0;
	const variants = db.select({ value: count() }).from(corpusVariants).get()?.value ?? 0;
	const missing =
		db
			.select({ value: count() })
			.from(corpusVariants)
			.where(eq(corpusVariants.missingUpstream, 1))
			.get()?.value ?? 0;
	const languages =
		db
			.select({ value: sql<number>`count(distinct ${corpusCards.language})` })
			.from(corpusCards)
			.get()?.value ?? 0;
	const images =
		db.select({ value: count() }).from(corpusCards).where(isNotNull(corpusCards.imageBytes)).get()
			?.value ?? 0;
	const bytes = db
		.select({ value: sum(corpusCards.imageByteSize) })
		.from(corpusCards)
		.get()?.value;
	const sets = db.select({ value: count() }).from(corpusSets).get()?.value ?? 0;
	const undatedSets =
		db.select({ value: count() }).from(corpusSets).where(isNull(corpusSets.releaseDate)).get()
			?.value ?? 0;

	return {
		cards,
		variants,
		variantsMissingUpstream: missing,
		languages,
		sets,
		setsWithoutReleaseDate: undatedSets,
		imagesStored: images,
		imageBytes: bytes === null || bytes === undefined ? 0 : Number(bytes),
	};
}

export function countVariants(db: GloomDatabase): number {
	return db.select({ value: count() }).from(corpusVariants).get()?.value ?? 0;
}

export interface StoredImage {
	readonly bytes: Buffer;
	readonly contentType: string;
	readonly hash: string | null;
}

export function readCardImage(db: GloomDatabase, cardKey: string): StoredImage | null {
	const row = db
		.select({
			bytes: corpusCards.imageBytes,
			contentType: corpusCards.imageContentType,
			hash: corpusCards.imageHash,
		})
		.from(corpusCards)
		.where(eq(corpusCards.cardKey, cardKey))
		.get();
	if (row === undefined || row.bytes === null) return null;
	return {
		bytes: row.bytes,
		contentType: row.contentType ?? "image/webp",
		hash: row.hash,
	};
}

/* -------------------------------------------------------------------------- */
/* Sync jobs                                                                   */
/* -------------------------------------------------------------------------- */

export type SyncStatus = "running" | "succeeded" | "failed" | "interrupted";

export function createSyncJob(db: GloomDatabase, id: string, now: number): void {
	db.insert(corpusSyncJobs)
		.values({ id, status: "running", phase: "languages", startedAt: now, updatedAt: now })
		.run();
}

export function readSyncJob(db: GloomDatabase, id: string) {
	return db.select().from(corpusSyncJobs).where(eq(corpusSyncJobs.id, id)).get() ?? null;
}

export function readLatestSyncJob(db: GloomDatabase) {
	return (
		db
			.select()
			.from(corpusSyncJobs)
			.orderBy(sql`${corpusSyncJobs.startedAt} desc`)
			.limit(1)
			.get() ?? null
	);
}

export function readActiveSyncJob(db: GloomDatabase) {
	return (
		db.select().from(corpusSyncJobs).where(eq(corpusSyncJobs.status, "running")).limit(1).get() ??
		null
	);
}

/** The last sync that finished cleanly; what "corpus last synced" means. */
export function readLastSuccessfulSyncAt(db: GloomDatabase): number | null {
	const row = db
		.select({ finishedAt: corpusSyncJobs.finishedAt })
		.from(corpusSyncJobs)
		.where(eq(corpusSyncJobs.status, "succeeded"))
		.orderBy(sql`${corpusSyncJobs.finishedAt} desc`)
		.limit(1)
		.get();
	return row?.finishedAt ?? null;
}

export type SyncJobPatch = Partial<{
	status: SyncStatus;
	phase: string;
	processed: number;
	total: number | null;
	message: string | null;
	error: string | null;
	finishedAt: number | null;
	languagesSynced: string;
	cardsUpserted: number;
	variantsUpserted: number;
	cardsFlaggedMissing: number;
	variantsFlaggedMissing: number;
	imagesFetched: number;
	imagesUnchanged: number;
	imageBytesFetched: number;
	setsFetched: number;
	setsUnchanged: number;
	setsFlaggedMissing: number;
	unknownAxisValues: string;
	variantCountBefore: number;
	variantCountAfter: number;
}>;

export function updateSyncJob(
	db: GloomDatabase,
	id: string,
	patch: SyncJobPatch,
	now: number,
): void {
	db.update(corpusSyncJobs)
		.set({ ...patch, updatedAt: now })
		.where(eq(corpusSyncJobs.id, id))
		.run();
}

/**
 * A job left `running` by a restart is not running. Called at boot, before anything can read a
 * status that would be a lie — this is the half of the "completion marker survives a restart"
 * requirement that a crash exercises.
 */
export function reconcileInterruptedJobs(db: GloomDatabase, now: number): number {
	db.update(corpusSyncJobs)
		.set({
			status: "interrupted",
			finishedAt: now,
			updatedAt: now,
			error: "the server restarted while this sync was running",
		})
		.where(eq(corpusSyncJobs.status, "running"))
		.run();
	return rowsChanged(db);
}
