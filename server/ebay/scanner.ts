import type { Marketplace } from "../../shared/listings.ts";
import {
	DEFAULT_DAILY_CALL_BUDGET,
	DEFAULT_SCAN_CURSOR_OVERLAP_MINUTES,
	DEFAULT_SCAN_KEYWORDS,
	MARKETPLACE_EVERY_N,
	MARKETPLACES,
} from "../../shared/listings.ts";
import { APP_STATE_KEYS, readAppStateNumber, writeAppState } from "../db/app-state.ts";
import type { GloomDatabase } from "../db/client.ts";
import { canSpend, recordCall } from "./budget.ts";
import { type EbayClient, EbayHttpError, windowNeedsNarrowing } from "./client.ts";
import {
	expireListings,
	readCursor,
	rememberCategory,
	seedCursors,
	upsertObserved,
	writeCursorFailure,
	writeCursorSuccess,
} from "./repository.ts";
import type { ObservedListing } from "./whitelist.ts";

/**
 * One forward-scan cycle.
 *
 * Per marketplace that is due: page the keyword search and its aspect sibling to exhaustion
 * or the remaining daily budget, union on `itemId`, persist the whitelist. The cursor
 * advances only when that marketplace finished. A thrown request increments
 * `consecutive_failures` and leaves the cursor where it was.
 *
 * No matching. Listings land; the feed shows them.
 */

const MIN_SLICE_MS = 60_000;

export interface ForwardScanDeps {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly now: () => number;
	readonly keywords?: readonly string[];
	readonly overlapMinutes?: number;
	readonly dailyBudget?: number;
}

export interface MarketplaceScanResult {
	readonly marketplace: Marketplace;
	readonly ran: boolean;
	readonly complete: boolean;
	readonly itemsUpserted: number;
	readonly calls: number;
	readonly cursorBefore: number | null;
	readonly cursorAfter: number | null;
	readonly consecutiveFailures: number;
	readonly error?: string;
}

export interface ForwardScanResult {
	readonly cycle: number;
	readonly expired: number;
	readonly marketplaces: readonly MarketplaceScanResult[];
}

export function marketplacesDueThisCycle(cycle: number): Marketplace[] {
	return MARKETPLACES.filter((marketplace) => cycle % MARKETPLACE_EVERY_N[marketplace] === 0);
}

export async function runForwardScan(deps: ForwardScanDeps): Promise<ForwardScanResult> {
	const now = deps.now();
	const keywords = deps.keywords ?? DEFAULT_SCAN_KEYWORDS;
	const overlapMs = (deps.overlapMinutes ?? DEFAULT_SCAN_CURSOR_OVERLAP_MINUTES) * 60_000;
	const budget = deps.dailyBudget ?? DEFAULT_DAILY_CALL_BUDGET;

	const expired = expireListings(deps.db, now);
	seedCursors(deps.db, now);

	const cycle = (readAppStateNumber(deps.db, APP_STATE_KEYS.scanCycleCount) ?? 0) + 1;
	writeAppState(deps.db, APP_STATE_KEYS.scanCycleCount, String(cycle), now);

	const due = new Set(marketplacesDueThisCycle(cycle));
	const marketplaces: MarketplaceScanResult[] = [];

	for (const marketplace of MARKETPLACES) {
		const before = readCursor(deps.db, marketplace);
		if (!due.has(marketplace)) {
			marketplaces.push({
				marketplace,
				ran: false,
				complete: false,
				itemsUpserted: 0,
				calls: 0,
				cursorBefore: before?.lastScannedAt ?? null,
				cursorAfter: before?.lastScannedAt ?? null,
				consecutiveFailures: before?.consecutiveFailures ?? 0,
			});
			continue;
		}

		const result = await scanOneMarketplace({
			db: deps.db,
			client: deps.client,
			marketplace,
			now,
			keywords,
			overlapMs,
			budget,
		});
		const after = readCursor(deps.db, marketplace);
		marketplaces.push({
			marketplace,
			ran: true,
			complete: result.complete,
			itemsUpserted: result.itemsUpserted,
			calls: result.calls,
			cursorBefore: before?.lastScannedAt ?? null,
			cursorAfter: after?.lastScannedAt ?? null,
			consecutiveFailures: after?.consecutiveFailures ?? 0,
			...(result.error === undefined ? {} : { error: result.error }),
		});
	}

	return { cycle, expired, marketplaces };
}

interface OneMarketplaceResult {
	readonly complete: boolean;
	readonly itemsUpserted: number;
	readonly calls: number;
	readonly error?: string;
}

async function scanOneMarketplace(args: {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly marketplace: Marketplace;
	readonly now: number;
	readonly keywords: readonly string[];
	readonly overlapMs: number;
	readonly budget: number;
}): Promise<OneMarketplaceResult> {
	let calls = 0;
	let itemsUpserted = 0;

	try {
		let categoryId = readCursor(args.db, args.marketplace)?.categoryId ?? null;
		if (categoryId === null) {
			if (!canSpend(args.db, args.now, args.budget)) {
				return { complete: false, itemsUpserted, calls };
			}
			const resolved = await args.client.resolveCategoryId(args.marketplace);
			calls += resolved.calls;
			recordCall(args.db, args.now, resolved.calls);
			if (resolved.categoryId === null) {
				writeCursorFailure(args.db, args.marketplace, args.now);
				return { complete: false, itemsUpserted, calls, error: "no category id from Taxonomy" };
			}
			categoryId = resolved.categoryId;
			rememberCategory(args.db, args.marketplace, categoryId, args.now);
		}

		const cursor = readCursor(args.db, args.marketplace)?.lastScannedAt ?? null;
		const from = (cursor ?? args.now) - args.overlapMs;
		const to = args.now;

		const windowResult = await scanWindow({
			db: args.db,
			client: args.client,
			marketplace: args.marketplace,
			categoryId,
			keywords: args.keywords,
			from,
			to,
			now: args.now,
			budget: args.budget,
		});
		calls += windowResult.calls;
		itemsUpserted += windowResult.itemsUpserted;

		if (windowResult.complete) {
			writeCursorSuccess(
				args.db,
				args.marketplace,
				windowResult.scannedThrough,
				args.now,
				categoryId,
			);
			return { complete: true, itemsUpserted, calls };
		}

		if (windowResult.error !== undefined) {
			writeCursorFailure(args.db, args.marketplace, args.now, categoryId);
			return { complete: false, itemsUpserted, calls, error: windowResult.error };
		}

		// Budget ran out mid-window. Not a failure — the cursor stays and tomorrow resumes.
		return { complete: false, itemsUpserted, calls };
	} catch (error) {
		const extra = error instanceof EbayHttpError ? error.calls : 0;
		if (extra > 0) {
			calls += extra;
			recordCall(args.db, args.now, extra);
		}
		writeCursorFailure(args.db, args.marketplace, args.now);
		return {
			complete: false,
			itemsUpserted,
			calls,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function scanWindow(args: {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly marketplace: Marketplace;
	readonly categoryId: string;
	readonly keywords: readonly string[];
	readonly from: number;
	readonly to: number;
	readonly now: number;
	readonly budget: number;
}): Promise<{
	readonly complete: boolean;
	readonly scannedThrough: number;
	readonly itemsUpserted: number;
	readonly calls: number;
	readonly error?: string;
}> {
	let calls = 0;
	let itemsUpserted = 0;

	for (const keyword of args.keywords) {
		for (const kind of ["keyword", "aspect"] as const) {
			if (!canSpend(args.db, args.now, args.budget)) {
				return { complete: false, scannedThrough: args.from, itemsUpserted, calls };
			}

			const first = await args.client.search({
				marketplace: args.marketplace,
				categoryId: args.categoryId,
				from: args.from,
				to: args.to,
				...(kind === "keyword" ? { keyword } : { aspectValue: keyword }),
			});
			calls += first.calls;
			recordCall(args.db, args.now, first.calls);

			if (windowNeedsNarrowing(first.total) && args.to - args.from > MIN_SLICE_MS) {
				const mid = args.from + Math.floor((args.to - args.from) / 2);
				const sliced = await scanWindow({ ...args, to: mid });
				return {
					complete: sliced.complete,
					scannedThrough: sliced.complete ? mid : args.from,
					itemsUpserted: itemsUpserted + sliced.itemsUpserted,
					calls: calls + sliced.calls,
					...(sliced.error === undefined ? {} : { error: sliced.error }),
				};
			}

			const firstPersist = persistPage(args.db, first.items, args.marketplace, args.now);
			itemsUpserted += firstPersist;

			let next = first.next;
			while (next !== null) {
				if (!canSpend(args.db, args.now, args.budget)) {
					return { complete: false, scannedThrough: args.from, itemsUpserted, calls };
				}
				const page = await args.client.search({
					marketplace: args.marketplace,
					categoryId: args.categoryId,
					from: args.from,
					to: args.to,
					next,
				});
				calls += page.calls;
				recordCall(args.db, args.now, page.calls);
				itemsUpserted += persistPage(args.db, page.items, args.marketplace, args.now);
				next = page.next;
			}
		}
	}

	return { complete: true, scannedThrough: args.to, itemsUpserted, calls };
}

function persistPage(
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
