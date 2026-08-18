import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import { PUSH_BASE_PATH } from "../shared/push.ts";
import { createBinderRoutes } from "./binder/http.ts";
import { createCopyRoutes } from "./copies/http.ts";
import { type CorpusSyncStarter, createCorpusRoutes } from "./corpus/http.ts";
import { countVariants, readLastSuccessfulSyncAt } from "./corpus/repository.ts";
import { defaultCorpusSyncStarter } from "./corpus/runner.ts";
import { APP_STATE_KEYS, readAppState, readAppStateNumber } from "./db/app-state.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { countAppliedMigrations } from "./db/migrate.ts";
import { createListingRoutes } from "./ebay/http.ts";
import { readScanHealth } from "./ebay/repository.ts";
import { createPushRoutes } from "./push/routes.ts";

export interface AppDependencies {
	readonly handle: DatabaseHandle;
	/** Absolute directory of built client assets; see `resolveFromRepo` in `config.ts`. */
	readonly clientDir: string;
	/** Injected so tests can drive time without a global clock mock. */
	readonly now?: () => number;
	/** Request logging. On in the server process, off under the test runner. */
	readonly requestLog?: boolean;
	/** Injected so a test can supply a VAPID environment without touching `process.env`. */
	readonly env?: Record<string, string | undefined>;
	/**
	 * How a created sync job gets worked on. Defaults to the real TCGdex runner; a test supplies
	 * its own so the HTTP layer can be exercised without the network.
	 */
	readonly startCorpusSync?: CorpusSyncStarter;
}

/**
 * The service worker script must never be cached. A cached worker pins the phone to old code
 * permanently, and there is no way to recover it from the server side.
 */
export const SERVICE_WORKER_PATH = "/sw.js";
export const SERVICE_WORKER_CACHE_CONTROL = "no-cache";

/**
 * Build the HTTP app. Kept separate from the process entry point so tests can exercise real
 * handlers against a real migrated SQLite database — the spec forbids mocking the database.
 */
export function createApp(deps: AppDependencies): Hono {
	const now = deps.now ?? (() => Date.now());
	const app = new Hono();

	if (deps.requestLog ?? false) {
		app.use("*", logger());
	}

	app.get(HEALTH_PATH, (c) => {
		const db = deps.handle.db;
		const body: HealthDocument = {
			service: "gloom-watch",
			timezone: readAppState(db, APP_STATE_KEYS.timezone) ?? "UTC",
			installedAt: readAppStateNumber(db, APP_STATE_KEYS.installedAt),
			lastHeartbeatAt: readAppStateNumber(db, APP_STATE_KEYS.lastHeartbeatAt),
			migrationsApplied: countAppliedMigrations(deps.handle),
			corpusLastSyncedAt: readLastSuccessfulSyncAt(db),
			corpusVariantCount: countVariants(db),
			scan: readScanHealth(db, now()),
			serverTimeMs: now(),
		};
		// The binder document is cacheable and revalidates on an ETag; health never is.
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});

	// Mounted before the static handlers, which match `*`.
	app.route(
		PUSH_BASE_PATH,
		createPushRoutes({
			handle: deps.handle,
			now,
			...(deps.env === undefined ? {} : { env: deps.env }),
		}),
	);

	app.route("/", createBinderRoutes({ db: deps.handle.db, now }));

	app.route("/", createCopyRoutes({ db: deps.handle.db, now }));

	app.route("/", createListingRoutes({ db: deps.handle.db, now }));

	app.route(
		"/",
		createCorpusRoutes({
			db: deps.handle.db,
			now,
			startCorpusSync: deps.startCorpusSync ?? defaultCorpusSyncStarter(deps.handle.db),
		}),
	);

	// `no-cache` on the worker itself, set before the static handler writes the body.
	app.use(SERVICE_WORKER_PATH, async (c, next) => {
		await next();
		c.header("Cache-Control", SERVICE_WORKER_CACHE_CONTROL);
	});

	app.use("*", serveStatic({ root: deps.clientDir }));

	// SPA fallback. The service worker is registered at `/` and its scope never moves, so every
	// unmatched path resolves to the same shell and TanStack Router takes it from there.
	// `path` is resolved inside `root`; an absolute `path` is not honoured.
	app.get("*", serveStatic({ root: deps.clientDir, path: "index.html" }));

	return app;
}
