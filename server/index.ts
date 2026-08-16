import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { reconcileInterruptedJobs } from "./corpus/repository.ts";
import { seedInitialState } from "./db/app-state.ts";
import { processDatabase } from "./db/client.ts";
import { applyMigrations } from "./db/migrate.ts";

/**
 * The HTTP server process.
 *
 * Supervision splits in two and the halves fail independently: this process runs under systemd
 * with `Restart=always` and `RestartSec=10` (see `deploy/gloom-watch.service`), while the
 * scheduled jobs are OS-level `Bun.cron` entries that survive reboots without it. A dead web
 * server does not stop notifications arriving.
 *
 * Exported as `{ port, hostname, fetch }` rather than calling `Bun.serve`: the only
 * Bun-specific APIs this codebase uses are `bun:sqlite` and `Bun.cron`, which is what keeps a
 * retreat to Node cheap and is why Hono was chosen over Elysia.
 */
const config = loadConfig();

const handle = processDatabase(config.databasePath);
applyMigrations(handle, config.migrationsDir);
seedInitialState(handle.db, config.defaultTimezone, Date.now());

// A corpus sync runs in this process, so a job still marked `running` when we boot is one this
// process was killed in the middle of. Reconciling it here, before anything can serve a status
// that would be a lie, is what makes the job's completion marker survive a restart.
const interrupted = reconcileInterruptedJobs(handle.db, Date.now());
if (interrupted > 0) {
	console.warn(`marked ${interrupted} corpus sync job(s) interrupted by a restart`);
}

const app = createApp({ handle, clientDir: config.clientDir, requestLog: true });

// An unbuilt client is a 404 on every page and nothing in the log to explain it. Say so once,
// rather than letting a commissioning session lose an hour to it.
if (!existsSync(join(config.clientDir, "index.html"))) {
	console.warn(
		`WARNING: no index.html under ${config.clientDir}. Run \`bun run build\` — the API will ` +
			"answer but every page will 404.",
	);
}

console.log(
	`gloom-watch listening on http://${config.host}:${config.port} ` +
		`(database ${config.databasePath}, client ${config.clientDir})`,
);

export default {
	port: config.port,
	hostname: config.host,
	fetch: app.fetch,
};
