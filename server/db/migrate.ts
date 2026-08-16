import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { loadConfig } from "../config.ts";
import { type DatabaseHandle, openDatabase } from "./client.ts";

/**
 * Drizzle's own bookkeeping table. Reading it is how the health document proves, from the
 * deployment box, that the migration actually ran there.
 */
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Apply every generated migration that this database has not seen. Idempotent, so the server
 * runs it on every boot.
 *
 * Migrations are generated with `drizzle-kit generate` and read before they are committed;
 * `drizzle-kit push` is never run against a real database.
 */
export function applyMigrations(handle: DatabaseHandle, migrationsFolder: string): void {
	migrate(handle.db, { migrationsFolder });
}

/** How many migrations this database has applied. Zero if the migrator has never run. */
export function countAppliedMigrations(handle: DatabaseHandle): number {
	const exists = handle.sqlite
		.query<{ name: string }, [string]>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
		)
		.get(MIGRATIONS_TABLE);
	if (exists === null) return 0;

	const row = handle.sqlite
		.query<{ count: number }, []>(`SELECT count(*) AS count FROM "${MIGRATIONS_TABLE}"`)
		.get();
	return row?.count ?? 0;
}

/** `bun run db:migrate` — apply migrations to the configured database and report. */
function main(): void {
	const config = loadConfig();
	const handle = openDatabase(config.databasePath);
	try {
		applyMigrations(handle, config.migrationsDir);
		console.log(
			`Applied migrations from ${config.migrationsDir} to ${config.databasePath}; ` +
				`${countAppliedMigrations(handle)} migration(s) recorded.`,
		);
	} finally {
		handle.close();
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
