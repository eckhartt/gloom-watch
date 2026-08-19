import type { Marketplace } from "../../shared/listings.ts";
import {
	DAY_MS,
	DEFAULT_BACKFILL_HORIZON_DAYS,
	DEFAULT_BACKFILL_WINDOW_DAYS,
	DEFAULT_DAILY_CALL_BUDGET,
	DEFAULT_SCAN_KEYWORDS,
	MARKETPLACES,
} from "../../shared/listings.ts";
import type { GloomDatabase } from "../db/client.ts";
import { canSpend, recordCall } from "./budget.ts";
import { type EbayClient, EbayHttpError } from "./client.ts";
import {
	beginBackfill,
	isBackfillComplete,
	markBackfillComplete,
	readBackfill,
	readCursor,
	rememberCategory,
	seedCursors,
	writeBackfillProgress,
	writeCursorSuccess,
} from "./repository.ts";
import { collectSearchWindow, enabledMarketplaces, MIN_SLICE_MS } from "./scanner.ts";

/**
 * The commissioning sweep. Backwards in `itemStartDate` windows, to a persisted horizon,
 * until each enabled marketplace is marked complete. It seeds the seen-set and does not
 * notify. The forward cursor for a marketplace does not run until that marker is set.
 */

export interface BackfillDeps {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly now: () => number;
	readonly keywords?: readonly string[];
	readonly horizonDays?: number;
	readonly windowDays?: number;
	readonly dailyBudget?: number;
	readonly log?: (message: string) => void;
}

export interface BackfillMarketplaceResult {
	readonly marketplace: Marketplace;
	readonly ran: boolean;
	readonly complete: boolean;
	readonly itemsSeen: number;
	readonly calls: number;
	readonly windowEnd: number | null;
	readonly horizonAt: number | null;
	readonly error?: string;
}

export interface BackfillResult {
	readonly horizonDays: number;
	readonly marketplaces: readonly BackfillMarketplaceResult[];
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillResult> {
	const now = deps.now();
	const keywords = deps.keywords ?? DEFAULT_SCAN_KEYWORDS;
	const horizonDays = deps.horizonDays ?? DEFAULT_BACKFILL_HORIZON_DAYS;
	const windowMs = (deps.windowDays ?? DEFAULT_BACKFILL_WINDOW_DAYS) * DAY_MS;
	const budget = deps.dailyBudget ?? DEFAULT_DAILY_CALL_BUDGET;
	const log = deps.log ?? (() => undefined);

	seedCursors(deps.db, now);

	const enabled = new Set(enabledMarketplaces());
	const marketplaces: BackfillMarketplaceResult[] = [];

	for (const marketplace of MARKETPLACES) {
		if (!enabled.has(marketplace)) {
			const row = readBackfill(deps.db, marketplace);
			marketplaces.push({
				marketplace,
				ran: false,
				complete: row?.completeAt != null,
				itemsSeen: row?.itemsUpserted ?? 0,
				calls: 0,
				windowEnd: row?.windowEnd ?? null,
				horizonAt: row?.horizonAt ?? null,
			});
			continue;
		}

		marketplaces.push(
			await backfillOneMarketplace({
				db: deps.db,
				client: deps.client,
				marketplace,
				now,
				keywords,
				horizonDays,
				windowMs,
				budget,
				log,
			}),
		);
	}

	return { horizonDays, marketplaces };
}

async function backfillOneMarketplace(args: {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly marketplace: Marketplace;
	readonly now: number;
	readonly keywords: readonly string[];
	readonly horizonDays: number;
	readonly windowMs: number;
	readonly budget: number;
	readonly log: (message: string) => void;
}): Promise<BackfillMarketplaceResult> {
	if (isBackfillComplete(args.db, args.marketplace)) {
		const row = readBackfill(args.db, args.marketplace);
		return finish(args.db, args.marketplace, {
			ran: false,
			complete: true,
			itemsSeen: row?.itemsUpserted ?? 0,
			calls: 0,
		});
	}

	const horizonAt = args.now - args.horizonDays * DAY_MS;
	const state = beginBackfill(args.db, args.marketplace, args.now, horizonAt);
	const persistedHorizon = state.horizonAt ?? horizonAt;
	let calls = 0;
	let itemsSeen = 0;

	args.log(
		`backfill ${args.marketplace}: resume windowEnd=${iso(state.windowEnd ?? args.now)} ` +
			`horizon=${iso(persistedHorizon)}`,
	);

	try {
		let categoryId = readCursor(args.db, args.marketplace)?.categoryId ?? null;
		if (categoryId === null) {
			if (!canSpend(args.db, args.now, args.budget)) {
				return finish(args.db, args.marketplace, { ran: true, complete: false, itemsSeen, calls });
			}
			const resolved = await args.client.resolveCategoryId(args.marketplace);
			calls += resolved.calls;
			recordCall(args.db, args.now, resolved.calls);
			writeBackfillProgress(args.db, args.marketplace, args.now, { callsDelta: resolved.calls });
			if (resolved.categoryId === null) {
				return finish(args.db, args.marketplace, {
					ran: true,
					complete: false,
					itemsSeen,
					calls,
					error: "no category id from Taxonomy",
				});
			}
			categoryId = resolved.categoryId;
			rememberCategory(args.db, args.marketplace, categoryId, args.now);
		}

		let windowEnd = state.windowEnd ?? args.now;
		while (windowEnd > persistedHorizon) {
			if (!canSpend(args.db, args.now, args.budget)) {
				args.log(`backfill ${args.marketplace}: budget spent; windowEnd left at ${iso(windowEnd)}`);
				return finish(args.db, args.marketplace, { ran: true, complete: false, itemsSeen, calls });
			}

			const from = Math.max(persistedHorizon, windowEnd - args.windowMs);
			const slice = await sweepRange({
				db: args.db,
				client: args.client,
				marketplace: args.marketplace,
				categoryId,
				keywords: args.keywords,
				from,
				to: windowEnd,
				now: args.now,
				budget: args.budget,
				log: args.log,
			});
			calls += slice.calls;
			itemsSeen += slice.itemsSeen;

			if (slice.status === "budget") {
				args.log(`backfill ${args.marketplace}: budget spent mid-window`);
				return finish(args.db, args.marketplace, { ran: true, complete: false, itemsSeen, calls });
			}
			if (slice.status === "error") {
				return finish(args.db, args.marketplace, {
					ran: true,
					complete: false,
					itemsSeen,
					calls,
					error: slice.error,
				});
			}

			windowEnd = from;
			args.log(
				`backfill ${args.marketplace}: swept to ${iso(windowEnd)} items=${itemsSeen} calls=${calls}`,
			);
		}

		markBackfillComplete(args.db, args.marketplace, args.now);
		const cursor = readCursor(args.db, args.marketplace);
		if (cursor?.lastScannedAt == null) {
			const startedAt = readBackfill(args.db, args.marketplace)?.startedAt ?? args.now;
			writeCursorSuccess(args.db, args.marketplace, startedAt, args.now, categoryId);
		}

		args.log(`backfill ${args.marketplace}: complete`);
		return finish(args.db, args.marketplace, { ran: true, complete: true, itemsSeen, calls });
	} catch (error) {
		const extra = error instanceof EbayHttpError ? error.calls : 0;
		if (extra > 0) {
			calls += extra;
			recordCall(args.db, args.now, extra);
			writeBackfillProgress(args.db, args.marketplace, args.now, { callsDelta: extra });
		}
		return finish(args.db, args.marketplace, {
			ran: true,
			complete: false,
			itemsSeen,
			calls,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function sweepRange(args: {
	readonly db: GloomDatabase;
	readonly client: EbayClient;
	readonly marketplace: Marketplace;
	readonly categoryId: string;
	readonly keywords: readonly string[];
	readonly from: number;
	readonly to: number;
	readonly now: number;
	readonly budget: number;
	readonly log: (message: string) => void;
}): Promise<{
	readonly status: "complete" | "budget" | "error";
	readonly itemsSeen: number;
	readonly calls: number;
	readonly error?: string;
}> {
	if (args.to <= args.from) {
		return { status: "complete", itemsSeen: 0, calls: 0 };
	}

	const collected = await collectSearchWindow(args);
	if (collected.status === "narrow") {
		if (collected.calls > 0) {
			writeBackfillProgress(args.db, args.marketplace, args.now, { callsDelta: collected.calls });
		}
		if (args.to - args.from <= MIN_SLICE_MS) {
			const forced = await collectSearchWindow({ ...args, forcePage: true });
			accumulateProgress(args, forced);
			if (forced.status === "budget") {
				return {
					status: "budget",
					itemsSeen: forced.itemsSeen,
					calls: collected.calls + forced.calls,
				};
			}
			writeBackfillProgress(args.db, args.marketplace, args.now, { windowEnd: args.from });
			return {
				status: "complete",
				itemsSeen: forced.itemsSeen,
				calls: collected.calls + forced.calls,
			};
		}

		const mid = args.from + Math.floor((args.to - args.from) / 2);
		args.log(
			`backfill ${args.marketplace}: narrowing ${iso(args.from)}..${iso(args.to)} at ${iso(mid)}`,
		);
		const recent = await sweepRange({ ...args, from: mid });
		if (recent.status !== "complete") {
			return {
				status: recent.status,
				itemsSeen: recent.itemsSeen,
				calls: collected.calls + recent.calls,
				...(recent.error === undefined ? {} : { error: recent.error }),
			};
		}
		writeBackfillProgress(args.db, args.marketplace, args.now, { windowEnd: mid });
		const older = await sweepRange({ ...args, to: mid });
		return {
			status: older.status,
			itemsSeen: recent.itemsSeen + older.itemsSeen,
			calls: collected.calls + recent.calls + older.calls,
			...(older.error === undefined ? {} : { error: older.error }),
		};
	}

	accumulateProgress(args, collected);
	if (collected.status === "budget") {
		return { status: "budget", itemsSeen: collected.itemsSeen, calls: collected.calls };
	}

	writeBackfillProgress(args.db, args.marketplace, args.now, { windowEnd: args.from });
	return { status: "complete", itemsSeen: collected.itemsSeen, calls: collected.calls };
}

function accumulateProgress(
	args: { readonly db: GloomDatabase; readonly marketplace: Marketplace; readonly now: number },
	collected: { readonly itemsSeen: number; readonly calls: number },
): void {
	if (collected.itemsSeen === 0 && collected.calls === 0) return;
	writeBackfillProgress(args.db, args.marketplace, args.now, {
		itemsDelta: collected.itemsSeen,
		callsDelta: collected.calls,
	});
}

function finish(
	db: GloomDatabase,
	marketplace: Marketplace,
	partial: {
		readonly ran: boolean;
		readonly complete: boolean;
		readonly itemsSeen: number;
		readonly calls: number;
		readonly error?: string;
	},
): BackfillMarketplaceResult {
	const row = readBackfill(db, marketplace);
	return {
		marketplace,
		ran: partial.ran,
		complete: partial.complete,
		itemsSeen: partial.itemsSeen,
		calls: partial.calls,
		windowEnd: row?.windowEnd ?? null,
		horizonAt: row?.horizonAt ?? null,
		...(partial.error === undefined ? {} : { error: partial.error }),
	};
}

function iso(epochMs: number): string {
	return new Date(epochMs).toISOString();
}
