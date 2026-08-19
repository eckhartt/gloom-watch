import { fileURLToPath } from "node:url";
import {
	DEFAULT_BACKFILL_HORIZON_DAYS,
	DEFAULT_BACKFILL_WINDOW_DAYS,
} from "../../shared/listings.ts";
import { loadDeploymentConfig } from "../config.ts";
import { processDatabase } from "../db/client.ts";
import { applyMigrations } from "../db/migrate.ts";
import { runBackfill } from "../ebay/backfill.ts";
import { EbayClient } from "../ebay/client.ts";
import { tryLoadEbayCredentials } from "../ebay/credentials.ts";

/**
 * `bun run backfill` — the commissioning sweep.
 *
 * Resumable. A spent daily budget leaves the per-marketplace window cursor and the next
 * invocation (or the next UTC day) continues rather than restarting. Until a marketplace
 * is marked complete, `gloom-watch-scan` will not run its forward cursor.
 *
 * Horizon is `BACKFILL_HORIZON_DAYS` (default 3650). A short horizon is how you commission
 * without spending the day's Browse budget; production already holds recent AU stock from
 * the forward scanner.
 *
 * This job notifies nothing. It seeds `seen_items` so the first forward cycle re-announces
 * nothing it just found.
 */

function readPositiveInt(raw: string | undefined, fallback: number, name: string): number {
	if (raw === undefined || raw === "") return fallback;
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
	}
	return value;
}

async function main(): Promise<void> {
	const config = loadDeploymentConfig();
	const credentials = tryLoadEbayCredentials();
	if (credentials === null) {
		console.log("backfill: skipped — eBay credentials are not configured");
		process.exitCode = 1;
		return;
	}

	const horizonDays = readPositiveInt(
		process.env.BACKFILL_HORIZON_DAYS,
		DEFAULT_BACKFILL_HORIZON_DAYS,
		"BACKFILL_HORIZON_DAYS",
	);
	const windowDays = readPositiveInt(
		process.env.BACKFILL_WINDOW_DAYS,
		DEFAULT_BACKFILL_WINDOW_DAYS,
		"BACKFILL_WINDOW_DAYS",
	);

	const handle = processDatabase(config.databasePath);
	applyMigrations(handle, config.migrationsDir);

	const client = new EbayClient(credentials, fetch);
	console.log(
		`backfill: starting against ${config.databasePath} horizonDays=${horizonDays} ` +
			`windowDays=${windowDays}`,
	);

	const result = await runBackfill({
		db: handle.db,
		client,
		now: () => Date.now(),
		horizonDays,
		windowDays,
		log: (message) => console.log(message),
	});

	const summary = result.marketplaces
		.map((entry) => {
			if (!entry.ran && entry.complete) return `${entry.marketplace}=already-complete`;
			if (!entry.ran) return `${entry.marketplace}=skip`;
			if (entry.error !== undefined) return `${entry.marketplace}=fail`;
			if (entry.complete) return `${entry.marketplace}=done:${entry.itemsSeen}`;
			return `${entry.marketplace}=partial:${entry.itemsSeen}`;
		})
		.join(" ");

	console.log(`backfill: horizonDays=${result.horizonDays} ${summary}`);
	handle.close();

	const failed = result.marketplaces.some((entry) => entry.error !== undefined);
	const unfinished = result.marketplaces.some((entry) => entry.ran && !entry.complete);
	if (failed) process.exitCode = 1;
	else if (unfinished) {
		console.log("backfill: incomplete — re-run when the daily call budget refreshes");
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
