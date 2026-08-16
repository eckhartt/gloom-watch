import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import { APP_STATE_KEYS, readAppState, readAppStateNumber } from "./db/app-state.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { countAppliedMigrations } from "./db/migrate.ts";

export interface AppDependencies {
	readonly handle: DatabaseHandle;
	/** Absolute directory of built client assets; see `resolveFromRepo` in `config.ts`. */
	readonly clientDir: string;
	/** Injected so tests can drive time without a global clock mock. */
	readonly now?: () => number;
	/** Request logging. On in the server process, off under the test runner. */
	readonly requestLog?: boolean;
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
			serverTimeMs: now(),
		};
		// The binder document will be cacheable; health never is.
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});

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
