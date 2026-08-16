import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type GloomDatabase = BunSQLiteDatabase<typeof schema>;

export interface DatabaseHandle {
	readonly db: GloomDatabase;
	/** The raw connection, for pragmas and for the migrator. */
	readonly sqlite: Database;
	close(): void;
}

/** `busy_timeout` in milliseconds. Fixed by the spec, not a tunable. */
export const BUSY_TIMEOUT_MS = 5000;

/**
 * Open one SQLite connection.
 *
 * **One connection per process, not one globally.** `Bun.cron`'s OS-level form runs a separate
 * process, so writes do not serialise for free across the HTTP server and the scheduled jobs.
 * WAL plus `busy_timeout = 5000` is the actual concurrency story, and it has to hold for a
 * `VACUUM INTO` running for ~1 second against a live writer once the database carries images.
 *
 * No FTS5: at ~765 variants a `LIKE` scan is microseconds.
 */
export function openDatabase(databasePath: string): DatabaseHandle {
	if (databasePath !== ":memory:") {
		mkdirSync(dirname(databasePath), { recursive: true });
	}

	const sqlite = new Database(databasePath, { create: true });

	// WAL is a no-op for an in-memory database, which reports `memory` and is correct to.
	sqlite.exec("PRAGMA journal_mode = WAL;");
	sqlite.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
	sqlite.exec("PRAGMA foreign_keys = ON;");

	const db = drizzle({ client: sqlite, schema });

	return {
		db,
		sqlite,
		close() {
			sqlite.close();
		},
	};
}

let processHandle: DatabaseHandle | null = null;

/**
 * The single connection belonging to *this* process. The HTTP server calls it once at boot;
 * each cron job process calls it once and gets its own.
 */
export function processDatabase(databasePath: string): DatabaseHandle {
	if (processHandle === null) {
		processHandle = openDatabase(databasePath);
	}
	return processHandle;
}
