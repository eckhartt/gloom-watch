import { eq, sql } from "drizzle-orm";
import { DEFAULT_DAILY_CALL_BUDGET } from "../../shared/listings.ts";
import type { GloomDatabase } from "../db/client.ts";
import { scanBudget } from "../db/schema.ts";

/**
 * The daily Browse/Taxonomy call budget.
 *
 * eBay's application quota is 5,000/day. The default here is 4,000 so paging has headroom
 * and a catch-up after an outage cannot spend the last thousand on one marketplace. Checked
 * *before* each call; a 429 still counts, because eBay spent it.
 *
 * The day is a UTC calendar date. The spec stores instants as epoch milliseconds and
 * calendar dates as `YYYY-MM-DD`; this is the latter.
 */

export function utcDay(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 10);
}

export function readCallsUsed(db: GloomDatabase, day: string): number {
	const row = db.select().from(scanBudget).where(eq(scanBudget.day, day)).get();
	return row?.callsUsed ?? 0;
}

export function remainingBudget(
	db: GloomDatabase,
	now: number,
	limit: number = DEFAULT_DAILY_CALL_BUDGET,
): number {
	return Math.max(0, limit - readCallsUsed(db, utcDay(now)));
}

/** True if a call may go out. The increment happens after, so a throw does not leak a count. */
export function canSpend(
	db: GloomDatabase,
	now: number,
	limit: number = DEFAULT_DAILY_CALL_BUDGET,
): boolean {
	return remainingBudget(db, now, limit) > 0;
}

export function recordCall(db: GloomDatabase, now: number, count = 1): void {
	const day = utcDay(now);
	db.insert(scanBudget)
		.values({ day, callsUsed: count, updatedAt: now })
		.onConflictDoUpdate({
			target: scanBudget.day,
			set: {
				callsUsed: sql`${scanBudget.callsUsed} + ${count}`,
				updatedAt: now,
			},
		})
		.run();
}
