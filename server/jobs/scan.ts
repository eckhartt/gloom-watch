import { loadDeploymentConfig } from "../config.ts";
import { processDatabase } from "../db/client.ts";
import { applyMigrations } from "../db/migrate.ts";
import { EbayClient } from "../ebay/client.ts";
import { tryLoadEbayCredentials } from "../ebay/credentials.ts";
import { runForwardScan } from "../ebay/scanner.ts";

/**
 * The forward scanner. A separate module default-exporting `{ scheduled }` because
 * `Bun.cron`'s OS-level form runs a real crontab entry in a new process — this cannot be a
 * closure inside the HTTP server, and it opens its own SQLite connection for the same reason.
 *
 * It loads the environment file itself. Cron is not systemd's child, so `EBAY_CLIENT_SECRET`
 * and `RELIST_HASH_SALT` are simply absent unless this process reads them. Found the hard way
 * on the push sender.
 *
 * Unconfigured credentials are a quiet no-op, not a crash: the keyset is owner action with
 * lead time, and a crashing cron every ten minutes would hide every other job's log.
 */
export default {
	async scheduled(controller: Bun.CronController): Promise<void> {
		const config = loadDeploymentConfig();
		const credentials = tryLoadEbayCredentials();
		if (credentials === null) {
			console.log(
				`scan: skipped — eBay credentials are not configured ` +
					`(scheduledTime=${controller.scheduledTime})`,
			);
			return;
		}

		const handle = processDatabase(config.databasePath);
		applyMigrations(handle, config.migrationsDir);

		const client = new EbayClient(credentials, fetch);
		const result = await runForwardScan({
			db: handle.db,
			client,
			now: () => Date.now(),
		});

		const summary = result.marketplaces
			.map((entry) => {
				if (!entry.ran) return `${entry.marketplace}=skip`;
				if (entry.error !== undefined) return `${entry.marketplace}=fail`;
				return `${entry.marketplace}=${entry.itemsUpserted}`;
			})
			.join(" ");

		console.log(
			`scan: cycle=${result.cycle} expired=${result.expired} ${summary} ` +
				`scheduledTime=${controller.scheduledTime}`,
		);
	},
};
