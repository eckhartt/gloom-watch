import { loadConfig } from "../config.ts";
import { APP_STATE_KEYS, writeAppState } from "../db/app-state.ts";
import { processDatabase } from "../db/client.ts";
import { applyMigrations } from "../db/migrate.ts";

/**
 * The skeleton's one scheduled job, and the proof that the OS-level `Bun.cron` path works end
 * to end on the deployment box: a separate process, opening its own SQLite connection, writing
 * a row the HTTP server then serves to the phone.
 *
 * It is a **separate module file default-exporting `{ scheduled }`** because `Bun.cron`'s
 * OS-level form runs a real crontab entry in a new process — none of these jobs can be a
 * closure inside the HTTP server. The scanner, the digest sender and the backup job take this
 * same shape in later tickets.
 *
 * It opens its own connection for the same reason. Writes do not serialise for free across
 * processes; WAL plus `busy_timeout = 5000` is what makes this safe against a live HTTP writer.
 *
 * Migrations are applied here too. The cron job can win the race to a fresh database after a
 * restore, and `migrate` is idempotent.
 */
export default {
	scheduled(controller: Bun.CronController): void {
		const config = loadConfig();
		const handle = processDatabase(config.databasePath);

		applyMigrations(handle, config.migrationsDir);
		writeAppState(
			handle.db,
			APP_STATE_KEYS.lastHeartbeatAt,
			String(controller.scheduledTime),
			controller.scheduledTime,
		);

		console.log(
			`heartbeat: cron=${controller.cron} type=${controller.type} ` +
				`scheduledTime=${controller.scheduledTime}`,
		);
	},
};
