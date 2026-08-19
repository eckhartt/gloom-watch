import type { Database } from "bun:sqlite";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { ListingDocument, Marketplace, ScanHealth } from "../../shared/listings.ts";
import {
	DEFAULT_DAILY_CALL_BUDGET,
	DISPLAY_FRESHNESS_MS,
	discloseAge,
	HOME_LOCATION_COUNTRY,
	LISTING_RETENTION_MS,
	MARKETPLACES,
	US_CATEGORY_ID,
} from "../../shared/listings.ts";
import type { MatcherCorpus } from "../../shared/matcher.ts";
import { APP_STATE_KEYS, readAppStateNumber } from "../db/app-state.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { BackfillCursorRow, ListingRow } from "../db/schema.ts";
import { backfillCursors, listings, scanCursors, seenItems } from "../db/schema.ts";
import { loadMatcherCorpus } from "../matcher/corpus.ts";
import { resolveListing } from "../matcher/resolve.ts";
import { readCallsUsed, utcDay } from "./budget.ts";
import type { ObservedListing } from "./whitelist.ts";

/**
 * Persist observed listings, the seen-set, and per-marketplace cursors.
 *
 * The feed reads from here. The seller hash is selected only when a later ticket needs it
 * for relist dedupe — `toListingDocument` never copies it onto the wire.
 */

export const FEED_PAGE_SIZE = 2000;

export function seedCursors(db: GloomDatabase, now: number): void {
	for (const marketplace of MARKETPLACES) {
		db.insert(scanCursors)
			.values({
				marketplace,
				lastScannedAt: null,
				lastSuccessAt: null,
				consecutiveFailures: 0,
				categoryId: marketplace === "US" ? US_CATEGORY_ID : null,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.run();
	}
}

export function readCursor(db: GloomDatabase, marketplace: Marketplace) {
	return (
		db.select().from(scanCursors).where(eq(scanCursors.marketplace, marketplace)).get() ?? null
	);
}

export function writeCursorSuccess(
	db: GloomDatabase,
	marketplace: Marketplace,
	scannedThrough: number,
	now: number,
	categoryId?: string | null,
): void {
	const current = readCursor(db, marketplace);
	db.insert(scanCursors)
		.values({
			marketplace,
			lastScannedAt: scannedThrough,
			lastSuccessAt: now,
			consecutiveFailures: 0,
			categoryId:
				categoryId ?? current?.categoryId ?? (marketplace === "US" ? US_CATEGORY_ID : null),
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: scanCursors.marketplace,
			set: {
				lastScannedAt: scannedThrough,
				lastSuccessAt: now,
				consecutiveFailures: 0,
				...(categoryId !== undefined ? { categoryId } : {}),
				updatedAt: now,
			},
		})
		.run();
}

export function writeCursorFailure(
	db: GloomDatabase,
	marketplace: Marketplace,
	now: number,
	categoryId?: string | null,
): void {
	const current = readCursor(db, marketplace);
	const failures = (current?.consecutiveFailures ?? 0) + 1;
	db.insert(scanCursors)
		.values({
			marketplace,
			lastScannedAt: current?.lastScannedAt ?? null,
			lastSuccessAt: current?.lastSuccessAt ?? null,
			consecutiveFailures: failures,
			categoryId: categoryId ?? current?.categoryId ?? null,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: scanCursors.marketplace,
			set: {
				consecutiveFailures: failures,
				...(categoryId !== undefined ? { categoryId } : {}),
				updatedAt: now,
			},
		})
		.run();
}

export function persistObservedPage(
	db: GloomDatabase,
	items: readonly ObservedListing[],
	marketplace: Marketplace,
	now: number,
): number {
	let created = 0;
	for (const item of items) {
		if (upsertObserved(db, item, marketplace, now).created) created += 1;
	}
	return created;
}

export function readBackfill(
	db: GloomDatabase,
	marketplace: Marketplace,
): BackfillCursorRow | null {
	return (
		db.select().from(backfillCursors).where(eq(backfillCursors.marketplace, marketplace)).get() ??
		null
	);
}

export function isBackfillComplete(db: GloomDatabase, marketplace: Marketplace): boolean {
	return readBackfill(db, marketplace)?.completeAt != null;
}

/**
 * Arm a marketplace's forward cursor in tests, or after a sweep that has already
 * reached the horizon. Production code path is `runBackfill`; this writes the same
 * marker that gate reads.
 */
export function markBackfillComplete(
	db: GloomDatabase,
	marketplace: Marketplace,
	now: number,
): void {
	const current = readBackfill(db, marketplace);
	db.insert(backfillCursors)
		.values({
			marketplace,
			completeAt: now,
			startedAt: current?.startedAt ?? now,
			horizonAt: current?.horizonAt ?? now,
			windowEnd: current?.windowEnd ?? current?.horizonAt ?? now,
			itemsUpserted: current?.itemsUpserted ?? 0,
			callsUsed: current?.callsUsed ?? 0,
			lastProgressAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: backfillCursors.marketplace,
			set: {
				completeAt: now,
				lastProgressAt: now,
				updatedAt: now,
			},
		})
		.run();
}

/**
 * First call writes the horizon and the resume cursor at `now`. Later calls
 * return the persisted row so a restart cannot slide the horizon forward.
 */
export function beginBackfill(
	db: GloomDatabase,
	marketplace: Marketplace,
	now: number,
	horizonAt: number,
): BackfillCursorRow {
	const existing = readBackfill(db, marketplace);
	if (existing?.startedAt != null) return existing;

	db.insert(backfillCursors)
		.values({
			marketplace,
			completeAt: null,
			startedAt: now,
			horizonAt,
			windowEnd: now,
			itemsUpserted: existing?.itemsUpserted ?? 0,
			callsUsed: existing?.callsUsed ?? 0,
			lastProgressAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: backfillCursors.marketplace,
			set: {
				startedAt: now,
				horizonAt,
				windowEnd: now,
				lastProgressAt: now,
				updatedAt: now,
			},
		})
		.run();

	const row = readBackfill(db, marketplace);
	if (row === null) throw new Error(`backfill cursor missing after begin for ${marketplace}`);
	return row;
}

export function writeBackfillProgress(
	db: GloomDatabase,
	marketplace: Marketplace,
	now: number,
	patch: {
		readonly windowEnd?: number;
		readonly itemsDelta?: number;
		readonly callsDelta?: number;
	},
): void {
	const current = readBackfill(db, marketplace);
	if (current === null || current.startedAt == null) {
		throw new Error(`writeBackfillProgress before beginBackfill for ${marketplace}`);
	}
	db.insert(backfillCursors)
		.values({
			marketplace,
			completeAt: current.completeAt,
			startedAt: current.startedAt,
			horizonAt: current.horizonAt,
			windowEnd: patch.windowEnd ?? current.windowEnd,
			itemsUpserted: current.itemsUpserted + (patch.itemsDelta ?? 0),
			callsUsed: current.callsUsed + (patch.callsDelta ?? 0),
			lastProgressAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: backfillCursors.marketplace,
			set: {
				...(patch.windowEnd !== undefined ? { windowEnd: patch.windowEnd } : {}),
				itemsUpserted: current.itemsUpserted + (patch.itemsDelta ?? 0),
				callsUsed: current.callsUsed + (patch.callsDelta ?? 0),
				lastProgressAt: now,
				updatedAt: now,
			},
		})
		.run();
}

export function rememberCategory(
	db: GloomDatabase,
	marketplace: Marketplace,
	categoryId: string,
	now: number,
): void {
	const current = readCursor(db, marketplace);
	db.insert(scanCursors)
		.values({
			marketplace,
			lastScannedAt: current?.lastScannedAt ?? null,
			lastSuccessAt: current?.lastSuccessAt ?? null,
			consecutiveFailures: current?.consecutiveFailures ?? 0,
			categoryId,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: scanCursors.marketplace,
			set: { categoryId, updatedAt: now },
		})
		.run();
}

export function upsertObserved(
	db: GloomDatabase,
	observed: ObservedListing,
	marketplace: Marketplace,
	now: number,
): { readonly created: boolean } {
	const existing = db
		.select({ itemId: listings.itemId })
		.from(listings)
		.where(eq(listings.itemId, observed.itemId))
		.get();

	db.insert(listings)
		.values({
			itemId: observed.itemId,
			marketplace,
			title: observed.title,
			priceMinor: observed.priceMinor,
			currency: observed.currency,
			buyingOption: observed.buyingOption,
			conditionId: observed.conditionId,
			itemWebUrl: observed.itemWebUrl,
			itemLocationCountry: observed.itemLocationCountry,
			itemOriginDate: observed.itemOriginDate,
			observedAt: now,
			sellerHash: observed.sellerHash,
			aspects: JSON.stringify(observed.aspects),
		})
		.onConflictDoUpdate({
			target: listings.itemId,
			set: {
				marketplace,
				title: observed.title,
				priceMinor: observed.priceMinor,
				currency: observed.currency,
				buyingOption: observed.buyingOption,
				conditionId: observed.conditionId,
				itemWebUrl: observed.itemWebUrl,
				itemLocationCountry: observed.itemLocationCountry,
				itemOriginDate: observed.itemOriginDate,
				observedAt: now,
				sellerHash: observed.sellerHash,
				aspects: JSON.stringify(observed.aspects),
			},
		})
		.run();

	const seen = db
		.select({ itemId: seenItems.itemId })
		.from(seenItems)
		.where(eq(seenItems.itemId, observed.itemId))
		.get();
	db.insert(seenItems)
		.values({ itemId: observed.itemId, firstSeenAt: now, lastSeenAt: now })
		.onConflictDoUpdate({
			target: seenItems.itemId,
			set: { lastSeenAt: now },
		})
		.run();

	return { created: existing === undefined && seen === undefined };
}

/**
 * Delete listing rows whose observation is older than 90 days.
 *
 * The seen-set is not touched. That is the whole of the retention rule: eBay content expires,
 * the opaque item id does not.
 */
/**
 * Drop listing rows whose seller hash matches a deletion notification.
 *
 * The seen-set is not touched — it holds no eBay user data. The incoming username never
 * enters this function; the caller hashes it first.
 */
export function deleteListingsBySellerHash(db: GloomDatabase, sellerHash: string): number {
	const doomed = db
		.select({ itemId: listings.itemId })
		.from(listings)
		.where(eq(listings.sellerHash, sellerHash))
		.all();
	if (doomed.length > 0) {
		db.delete(listings).where(eq(listings.sellerHash, sellerHash)).run();
	}
	return doomed.length;
}

export function expireListings(db: GloomDatabase, now: number): number {
	const cutoff = now - LISTING_RETENTION_MS;
	const doomed = db
		.select({ itemId: listings.itemId })
		.from(listings)
		.where(lt(listings.observedAt, cutoff))
		.all();
	if (doomed.length > 0) {
		db.delete(listings).where(lt(listings.observedAt, cutoff)).run();
	}
	return doomed.length;
}

export function toListingDocument(
	row: ListingRow,
	now: number,
	corpus: MatcherCorpus,
): ListingDocument {
	const ageMs = Math.max(0, now - row.observedAt);
	const stale = ageMs > DISPLAY_FRESHNESS_MS;
	return {
		itemId: row.itemId,
		marketplace: row.marketplace,
		title: row.title,
		priceMinor: stale ? null : row.priceMinor,
		currency: stale ? null : row.currency,
		priceHidden: stale,
		ageDisclosed: discloseAge(ageMs),
		buyingOption: row.buyingOption,
		itemWebUrl: row.itemWebUrl,
		itemLocationCountry: row.itemLocationCountry,
		itemOriginDate: row.itemOriginDate,
		observedAt: row.observedAt,
		ageMs,
		match: resolveListing(
			{
				title: row.title,
				itemLocationCountry: row.itemLocationCountry,
				aspects: parseAspects(row.aspects),
			},
			corpus,
		),
	};
}

export function parseAspects(raw: string): Readonly<Record<string, string>> {
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

export function readLocationFacets(
	db: GloomDatabase,
	marketplaces?: readonly Marketplace[],
): { readonly country: string; readonly count: number }[] {
	const wanted =
		marketplaces !== undefined && marketplaces.length > 0 ? [...marketplaces] : undefined;
	const rows = db
		.select({
			country: listings.itemLocationCountry,
			count: sql<number>`count(*)`.as("count"),
		})
		.from(listings)
		.where(wanted === undefined ? undefined : inArray(listings.marketplace, wanted))
		.groupBy(listings.itemLocationCountry)
		.all();
	return rows
		.map((row) => ({
			country: row.country ?? "??",
			count: Number(row.count),
		}))
		.sort((a, b) => {
			if (a.country === HOME_LOCATION_COUNTRY) return -1;
			if (b.country === HOME_LOCATION_COUNTRY) return 1;
			return b.count - a.count;
		});
}

export function readRecentListings(
	db: GloomDatabase,
	now: number,
	limit = FEED_PAGE_SIZE,
	marketplaces?: readonly Marketplace[],
	locations?: readonly string[],
): ListingDocument[] {
	const wantedMarkets =
		marketplaces !== undefined && marketplaces.length > 0 ? [...marketplaces] : undefined;
	const wantedLocations =
		locations !== undefined && locations.length > 0 ? [...locations] : undefined;
	const filters = [
		wantedMarkets === undefined ? undefined : inArray(listings.marketplace, wantedMarkets),
		wantedLocations === undefined
			? undefined
			: inArray(listings.itemLocationCountry, wantedLocations),
	].filter((clause) => clause !== undefined);

	const rows = db
		.select()
		.from(listings)
		.where(filters.length === 0 ? undefined : and(...filters))
		.orderBy(
			sql`case when ${listings.itemLocationCountry} = ${HOME_LOCATION_COUNTRY} then 0 else 1 end`,
			desc(listings.observedAt),
			asc(listings.itemId),
		)
		.limit(limit)
		.all();
	const corpus = loadMatcherCorpus(db);
	return rows.map((row) => toListingDocument(row, now, corpus));
}

export function readListing(
	db: GloomDatabase,
	itemId: string,
	now: number,
): ListingDocument | null {
	const row = db.select().from(listings).where(eq(listings.itemId, itemId)).get();
	if (row === undefined) return null;
	return toListingDocument(row, now, loadMatcherCorpus(db));
}

export function readScanHealth(
	db: GloomDatabase,
	now: number,
	budget = DEFAULT_DAILY_CALL_BUDGET,
): ScanHealth {
	const rows = db.select().from(scanCursors).all();
	const byMarketplace = new Map(rows.map((row) => [row.marketplace, row]));
	const backfillRows = db.select().from(backfillCursors).all();
	const backfillByMarketplace = new Map(backfillRows.map((row) => [row.marketplace, row]));
	return {
		cycle: readAppStateNumber(db, APP_STATE_KEYS.scanCycleCount) ?? 0,
		dailyCallsUsed: readCallsUsed(db, utcDay(now)),
		dailyCallBudget: budget,
		marketplaces: MARKETPLACES.map((marketplace) => {
			const row = byMarketplace.get(marketplace);
			const backfill = backfillByMarketplace.get(marketplace);
			return {
				marketplace,
				lastScannedAt: row?.lastScannedAt ?? null,
				lastSuccessAt: row?.lastSuccessAt ?? null,
				consecutiveFailures: row?.consecutiveFailures ?? 0,
				categoryId: row?.categoryId ?? null,
				backfillCompleteAt: backfill?.completeAt ?? null,
				backfillStartedAt: backfill?.startedAt ?? null,
				backfillHorizonAt: backfill?.horizonAt ?? null,
				backfillWindowEnd: backfill?.windowEnd ?? null,
				backfillItemsUpserted: backfill?.itemsUpserted ?? 0,
			};
		}),
	};
}

/**
 * Every stored text (and stringified non-text) value in the database. Used by the test that
 * asserts a fixture seller username cannot be recovered from any column of any table.
 */
/**
 * Every stored text (and stringified scalar) in the database. Used by the test that
 * asserts a fixture seller username cannot be recovered from any column of any table.
 *
 * BLOBs are skipped: a username cannot hide in a webp without also being a string column
 * we already scan, and decoding 26 MB of card art is not a test.
 */
export function everyPersistedText(sqlite: Database): string[] {
	const tables = sqlite
		.query<{ name: string }, []>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
		)
		.all();
	const values: string[] = [];
	for (const table of tables) {
		const rows = sqlite.query<Record<string, unknown>, []>(`SELECT * FROM "${table.name}"`).all();
		for (const row of rows) {
			for (const value of Object.values(row)) {
				if (value === null || value === undefined) continue;
				if (typeof value === "string") values.push(value);
				else if (typeof value === "number" || typeof value === "bigint") {
					values.push(String(value));
				}
			}
		}
	}
	return values;
}
