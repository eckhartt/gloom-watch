import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MIGRATIONS_DIR, resolveFromRepo } from "../../server/config.ts";
import { type DatabaseHandle, openDatabase } from "../../server/db/client.ts";
import { applyMigrations } from "../../server/db/migrate.ts";

export const MIGRATIONS_DIR = resolveFromRepo(DEFAULT_MIGRATIONS_DIR);

/**
 * How many migrations are committed, read from the Drizzle journal rather than written down.
 *
 * Hard-coding the number means every ticket that adds a table also has to edit four unrelated
 * assertions — and two branches adding a migration each break the other's tests on merge for no
 * reason that has anything to do with what either changed.
 */
export function committedMigrationCount(): number {
	const journal = JSON.parse(
		readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
	) as {
		entries: unknown[];
	};
	return journal.entries.length;
}

export interface TempDatabase {
	readonly handle: DatabaseHandle;
	readonly path: string;
	dispose(): void;
}

/**
 * A real on-disk SQLite database with the committed migrations applied.
 *
 * On disk rather than `:memory:` because WAL is exactly what these tests need to observe, and
 * an in-memory database reports `journal_mode = memory` however it is opened.
 */
export function createTempDatabase(): TempDatabase {
	const dir = mkdtempSync(join(tmpdir(), "gloom-watch-test-"));
	const path = join(dir, "gloom-watch.db");
	const handle = openDatabase(path);
	applyMigrations(handle, MIGRATIONS_DIR);

	return {
		handle,
		path,
		dispose() {
			handle.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
