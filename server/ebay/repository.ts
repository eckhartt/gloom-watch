import type { Database } from "bun:sqlite";
import { desc, eq, lt } from "drizzle-orm";
import type { ListingDocument, Marketplace, ScanHealth } from "../../shared/listings.ts";
import {
	DEFAULT_DAILY_CALL_BUDGET,
	DISPLAY_FRESHNESS_MS,
	discloseAge,
	LISTING_RETENTION_MS,
	MARKETPLACES,
	US_CATEGORY_ID,
} from "../../shared/listings.ts";
import { APP_STATE_KEYS, readAppStateNumber } from "../db/app-state.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { ListingRow } from "../db/schema.ts";
import { listings, scanCursors, seenItems } from "../db/schema.ts";
import { readCallsUsed, utcDay } from "./budget.ts";
import type { ObservedListing } from "./whitelist.ts";

/**
 * Persist observed listings, the seen-set, and per-marketplace cursors.
 *
 * The feed reads from here. The seller hash is selected only when a later ticket needs it
 * for relist dedupe — `toListingDocument` never copies it onto the wire.
 */

export const FEED_PAGE_SIZE = 100;

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

export function toListingDocument(row: ListingRow, now: number): ListingDocument {
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
	};
}

export function readRecentListings(
	db: GloomDatabase,
	now: number,
	limit = FEED_PAGE_SIZE,
): ListingDocument[] {
	const rows = db.select().from(listings).orderBy(desc(listings.observedAt)).limit(limit).all();
	return rows.map((row) => toListingDocument(row, now));
}

export function readListing(
	db: GloomDatabase,
	itemId: string,
	now: number,
): ListingDocument | null {
	const row = db.select().from(listings).where(eq(listings.itemId, itemId)).get();
	return row === undefined ? null : toListingDocument(row, now);
}

export function readScanHealth(
	db: GloomDatabase,
	now: number,
	budget = DEFAULT_DAILY_CALL_BUDGET,
): ScanHealth {
	const rows = db.select().from(scanCursors).all();
	const byMarketplace = new Map(rows.map((row) => [row.marketplace, row]));
	return {
		cycle: readAppStateNumber(db, APP_STATE_KEYS.scanCycleCount) ?? 0,
		dailyCallsUsed: readCallsUsed(db, utcDay(now)),
		dailyCallBudget: budget,
		marketplaces: MARKETPLACES.map((marketplace) => {
			const row = byMarketplace.get(marketplace);
			return {
				marketplace,
				lastScannedAt: row?.lastScannedAt ?? null,
				lastSuccessAt: row?.lastSuccessAt ?? null,
				consecutiveFailures: row?.consecutiveFailures ?? 0,
				categoryId: row?.categoryId ?? null,
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
