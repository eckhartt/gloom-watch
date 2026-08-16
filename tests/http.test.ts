import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, SERVICE_WORKER_CACHE_CONTROL, SERVICE_WORKER_PATH } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { APP_STATE_KEYS, seedInitialState, writeAppState } from "../server/db/app-state.ts";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import {
	committedMigrationCount,
	createTempDatabase,
	type TempDatabase,
} from "./helpers/temp-database.ts";

/**
 * Hono's handlers against a real migrated SQLite database. The spec is explicit: do not mock
 * the database.
 */
describe(`GET ${HEALTH_PATH}`, () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", 1_700_000_000_000);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => 1_800_000_000_000,
		});
	}

	it("answers with values read out of SQLite", async () => {
		const response = await app().request(HEALTH_PATH);
		expect(response.status).toBe(200);

		const body = (await response.json()) as HealthDocument;
		expect(body.service).toBe("gloom-watch");
		expect(body.timezone).toBe("Australia/Brisbane");
		expect(body.installedAt).toBe(1_700_000_000_000);
		expect(body.migrationsApplied).toBe(committedMigrationCount());
		expect(body.serverTimeMs).toBe(1_800_000_000_000);
	});

	it("reports no heartbeat until the cron job has written one", async () => {
		const before = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(before.lastHeartbeatAt).toBeNull();

		// What `server/jobs/heartbeat.ts` does, from its own process and its own connection.
		writeAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt, "1786800000000", 1786800000000);

		const after = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(after.lastHeartbeatAt).toBe(1786800000000);
	});

	it("is never cached", async () => {
		const response = await app().request(HEALTH_PATH);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
});

describe("static assets", () => {
	let temp: TempDatabase;
	let clientDir: string;

	beforeEach(() => {
		temp = createTempDatabase();
		// Absolute, and outside the repository, so this also proves the static handler does not
		// depend on the process working directory — the cron job and the service do not share one.
		clientDir = mkdtempSync(join(tmpdir(), "gloom-watch-client-"));
		writeFileSync(join(clientDir, "sw.js"), "// service worker\n");
		writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>shell</title>");
	});

	afterEach(() => {
		temp.dispose();
		rmSync(clientDir, { recursive: true, force: true });
	});

	function app() {
		return createApp({ handle: temp.handle, clientDir });
	}

	it("serves sw.js with Cache-Control: no-cache", async () => {
		// A cached worker pins the phone to old code permanently, and nothing server-side can
		// recover it. This assertion is the guard on that.
		const response = await app().request(SERVICE_WORKER_PATH);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe(SERVICE_WORKER_CACHE_CONTROL);
		expect(SERVICE_WORKER_CACHE_CONTROL).toBe("no-cache");
	});

	it("falls back to the app shell for a client route, so the SW scope never has to move", async () => {
		const response = await app().request("/binder");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("<title>shell</title>");
	});
});
