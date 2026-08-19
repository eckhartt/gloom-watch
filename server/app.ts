import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import { UNLOCK_API_PATH, UNLOCK_PATH } from "../shared/gate.ts";
import { PUSH_BASE_PATH } from "../shared/push.ts";
import { createBinderRoutes } from "./binder/http.ts";
import { createCopyRoutes } from "./copies/http.ts";
import { type CorpusSyncStarter, createCorpusRoutes } from "./corpus/http.ts";
import { createManualRoutes } from "./corpus/manual-http.ts";
import { countVariants, readLastSuccessfulSyncAt } from "./corpus/repository.ts";
import { defaultCorpusSyncStarter } from "./corpus/runner.ts";
import { APP_STATE_KEYS, readAppState, readAppStateNumber } from "./db/app-state.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { countAppliedMigrations } from "./db/migrate.ts";
import { createListingRoutes } from "./ebay/http.ts";
import { createNotificationRoutes } from "./ebay/notifications.ts";
import { readScanHealth } from "./ebay/repository.ts";
import {
	attachGateCookie,
	clearGateCookie,
	gateMiddleware,
	readSharedSecret,
	unlockPageHtml,
} from "./gate.ts";
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
	/** Public origin, used for the eBay challenge hash and the Secure cookie flag. */
	readonly publicOrigin?: string;
}

/**
 * The service worker script must never be cached. A cached worker pins the phone to old code
 * permanently, and there is no way to recover it from the server side.
 */
export const SERVICE_WORKER_PATH = "/sw.js";
export const SERVICE_WORKER_CACHE_CONTROL = "no-cache";

function emptyToNull(value: string | undefined): string | null {
	return value !== undefined && value !== "" ? value : null;
}

async function readOfferedSecret(c: {
	req: {
		header: (name: string) => string | undefined;
		parseBody: () => Promise<unknown>;
		json: () => Promise<unknown>;
	};
}): Promise<string | null> {
	const contentType = c.req.header("content-type") ?? "";
	if (contentType.includes("application/json")) {
		try {
			const body = (await c.req.json()) as { secret?: unknown };
			return typeof body.secret === "string" ? body.secret : null;
		} catch {
			return null;
		}
	}
	const body = (await c.req.parseBody()) as Record<string, unknown>;
	const value = body.secret;
	return typeof value === "string" ? value : null;
}

/**
 * Build the HTTP app. Kept separate from the process entry point so tests can exercise real
 * handlers against a real migrated SQLite database — the spec forbids mocking the database.
 */
export function createApp(deps: AppDependencies): Hono {
	const now = deps.now ?? (() => Date.now());
	const env = deps.env ?? process.env;
	const publicOrigin = deps.publicOrigin ?? "http://127.0.0.1:3000";
	const secret = readSharedSecret(env);
	const app = new Hono();

	if (deps.requestLog ?? false) {
		app.use("*", logger());
	}

	app.use("*", gateMiddleware(secret));

	const serveUnlockPage = (c: Context) => {
		c.header("Cache-Control", "no-store");
		return c.html(unlockPageHtml());
	};

	app.get(UNLOCK_PATH, serveUnlockPage);
	// Same document under `/api`, because the *currently installed* service worker intercepts
	// every navigation except `/api/` and would otherwise replace `/unlock` with the app shell.
	app.get(UNLOCK_API_PATH, serveUnlockPage);

	app.post(UNLOCK_API_PATH, async (c) => {
		c.header("Cache-Control", "no-store");
		if (secret === null) {
			return c.json({ error: "no shared secret is configured" }, 503);
		}
		const offered = await readOfferedSecret(c);
		if (offered === null || offered !== secret) {
			return c.html(
				unlockPageHtml().replace("</form>", '<p class="error">That is not the secret.</p></form>'),
				401,
			);
		}
		attachGateCookie(c, secret, publicOrigin);
		return c.redirect("/", 303);
	});

	app.post(`${UNLOCK_API_PATH}/clear`, (c) => {
		clearGateCookie(c, publicOrigin);
		return c.redirect(UNLOCK_PATH, 303);
	});

	app.route(
		"/",
		createNotificationRoutes({
			db: deps.handle.db,
			publicOrigin,
			verificationToken: emptyToNull(env.EBAY_NOTIFICATION_VERIFICATION_TOKEN),
			relistHashSalt: emptyToNull(env.RELIST_HASH_SALT),
		}),
	);

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

	app.route("/", createManualRoutes({ db: deps.handle.db, now }));

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
