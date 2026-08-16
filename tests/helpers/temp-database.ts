import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MIGRATIONS_DIR, resolveFromRepo } from "../../server/config.ts";
import { type DatabaseHandle, openDatabase } from "../../server/db/client.ts";
import { applyMigrations } from "../../server/db/migrate.ts";

export const MIGRATIONS_DIR = resolveFromRepo(DEFAULT_MIGRATIONS_DIR);

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
