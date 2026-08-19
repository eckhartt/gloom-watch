import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	APP_STATE_KEYS,
	readAppState,
	readAppStateNumber,
	seedInitialState,
	writeAppState,
} from "../server/db/app-state.ts";
import { BUSY_TIMEOUT_MS } from "../server/db/client.ts";
import { countAppliedMigrations } from "../server/db/migrate.ts";
import {
	committedMigrationCount,
	createTempDatabase,
	type TempDatabase,
} from "./helpers/temp-database.ts";

describe("the SQLite connection", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	it("imports bun:sqlite from a Vitest test", () => {
		// The whole reason Vitest is run through `bun --bun`. If this constructor is missing the
		// runner is wrong, whatever else passes.
		const scratch = new Database(":memory:");
		expect(scratch.query<{ answer: number }, []>("SELECT 1 AS answer").get()).toEqual({
			answer: 1,
		});
		scratch.close();
	});

	it("is in WAL mode", () => {
		const row = temp.handle.sqlite.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
		expect(row?.journal_mode).toBe("wal");
	});

	it("has busy_timeout set to 5000ms", () => {
		const row = temp.handle.sqlite.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
		expect(row?.timeout).toBe(BUSY_TIMEOUT_MS);
		expect(BUSY_TIMEOUT_MS).toBe(5000);
	});

	it("has no FTS5 virtual tables", () => {
		// The spec rules FTS5 out: at ~765 variants a LIKE scan is microseconds.
		const rows = temp.handle.sqlite
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE sql LIKE '%fts5%' COLLATE NOCASE",
			)
			.all();
		expect(rows).toEqual([]);
	});
});

describe("the committed migration", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	it("creates listings as a field whitelist with no seller username column", () => {
		const columns = temp.handle.sqlite
			.query<{ name: string }, []>("PRAGMA table_info(listings)")
			.all()
			.map((c) => c.name);

		expect(columns).toEqual([
			"item_id",
			"marketplace",
			"title",
			"price_minor",
			"currency",
			"buying_option",
			"condition_id",
			"item_web_url",
			"item_location_country",
			"item_origin_date",
			"observed_at",
			"seller_hash",
			"aspects",
		]);
		expect(columns.some((name) => name.includes("seller") && name !== "seller_hash")).toBe(false);
		expect(columns.some((name) => name.includes("username"))).toBe(false);
	});

	it("creates a seen-set that cannot expire with the listings", () => {
		const columns = temp.handle.sqlite
			.query<{ name: string }, []>("PRAGMA table_info(seen_items)")
			.all()
			.map((c) => c.name);
		expect(columns).toEqual(["item_id", "first_seen_at", "last_seen_at"]);
	});

	it("creates per-marketplace scan cursors", () => {
		const columns = temp.handle.sqlite
			.query<{ name: string }, []>("PRAGMA table_info(scan_cursors)")
			.all()
			.map((c) => c.name);
		expect(columns).toEqual([
			"marketplace",
			"last_scanned_at",
			"last_success_at",
			"consecutive_failures",
			"category_id",
			"updated_at",
		]);
	});

	it("creates per-marketplace backfill cursors without touching scan_cursors", () => {
		const columns = temp.handle.sqlite
			.query<{ name: string }, []>("PRAGMA table_info(backfill_cursors)")
			.all()
			.map((c) => c.name);
		expect(columns).toEqual([
			"marketplace",
			"complete_at",
			"started_at",
			"horizon_at",
			"window_end",
			"items_upserted",
			"calls_used",
			"last_progress_at",
			"updated_at",
		]);
	});

	it("creates app_state with the expected columns", () => {
		const columns = temp.handle.sqlite
			.query<{ name: string; type: string; notnull: number; pk: number }, []>(
				"PRAGMA table_info(app_state)",
			)
			.all();

		expect(columns.map((c) => c.name)).toEqual(["key", "value", "updated_at"]);
		expect(columns.find((c) => c.name === "key")?.pk).toBe(1);
		expect(columns.every((c) => c.notnull === 1)).toBe(true);
	});

	it("is recorded so a deployment can prove it ran", () => {
		expect(countAppliedMigrations(temp.handle)).toBe(committedMigrationCount());
	});

	it("is idempotent when applied twice", () => {
		// The server applies migrations on every boot, and so does the cron process.
		expect(() => createTempDatabase().dispose()).not.toThrow();
		expect(countAppliedMigrations(temp.handle)).toBe(committedMigrationCount());
	});
});

describe("app_state", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	it("round-trips a value", () => {
		writeAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt, "1786800000000", 1786800000000);
		expect(readAppStateNumber(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt)).toBe(1786800000000);
	});

	it("overwrites on a second write to the same key", () => {
		writeAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt, "1", 1);
		writeAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt, "2", 2);
		expect(readAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt)).toBe("2");
	});

	it("returns null for a key that was never written", () => {
		expect(readAppState(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt)).toBeNull();
		expect(readAppStateNumber(temp.handle.db, APP_STATE_KEYS.lastHeartbeatAt)).toBeNull();
	});

	it("seeds on first boot and never overwrites on later boots", () => {
		seedInitialState(temp.handle.db, "Australia/Brisbane", 1000);
		// The owner then changes the timezone on the settings screen.
		writeAppState(temp.handle.db, APP_STATE_KEYS.timezone, "Pacific/Auckland", 2000);
		// A restart must not stamp the environment's value back over it.
		seedInitialState(temp.handle.db, "Australia/Brisbane", 3000);

		expect(readAppState(temp.handle.db, APP_STATE_KEYS.timezone)).toBe("Pacific/Auckland");
		expect(readAppStateNumber(temp.handle.db, APP_STATE_KEYS.installedAt)).toBe(1000);
	});
});
