import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every path and port the server needs, resolved from the environment once.
 *
 * The database file defaults under `data/`, which `.gitignore` excludes along with `photos/`,
 * `backups/` and `*.db*`. Siting it anywhere else risks committing the collection to a public
 * repository, so the default is deliberate and the override is explicit.
 *
 * **Relative paths resolve against the repository root, not the working directory.** The HTTP
 * server runs under systemd with a `WorkingDirectory`; an OS-level `Bun.cron` job is a separate
 * process started by cron with a working directory of its own choosing. Resolving from cwd
 * would let the two open different database files and neither would report an error.
 */

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ServerConfig {
	/** Absolute path to the SQLite file, or the literal `:memory:`. */
	readonly databasePath: string;
	/** Absolute path to the built client assets that Hono serves. */
	readonly clientDir: string;
	/** Absolute path to the generated Drizzle migrations. */
	readonly migrationsDir: string;
	/** Interface to bind. Tailscale Serve proxies to loopback, so loopback is the default. */
	readonly host: string;
	readonly port: number;
	/** IANA timezone seeded on first boot only; thereafter the database is authoritative. */
	readonly defaultTimezone: string;
}

export const DEFAULT_DATABASE_PATH = "data/gloom-watch.db";
export const DEFAULT_CLIENT_DIR = "dist/client";
export const DEFAULT_MIGRATIONS_DIR = "drizzle";

/** `:memory:` is a SQLite keyword, not a path, and must survive untouched. */
export function resolveFromRepo(path: string): string {
	if (path === ":memory:" || isAbsolute(path)) return path;
	return resolve(REPO_ROOT, path);
}

function readPort(raw: string | undefined): number {
	if (raw === undefined || raw === "") return 3000;
	const port = Number.parseInt(raw, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`PORT must be an integer between 1 and 65535, got ${JSON.stringify(raw)}`);
	}
	return port;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
	return {
		databasePath: resolveFromRepo(env.GLOOM_WATCH_DB || DEFAULT_DATABASE_PATH),
		clientDir: resolveFromRepo(env.GLOOM_WATCH_CLIENT_DIR || DEFAULT_CLIENT_DIR),
		migrationsDir: resolveFromRepo(env.GLOOM_WATCH_MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR),
		host: env.HOST || "127.0.0.1",
		port: readPort(env.PORT),
		defaultTimezone: env.GLOOM_WATCH_TIMEZONE || "UTC",
	};
}
