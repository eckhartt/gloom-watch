import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvironmentFile } from "./env-file.ts";

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
	/**
	 * The origin the phone reaches the app on — the Tailscale Serve hostname in production.
	 *
	 * A push notification's `navigate` target has to be an absolute same-origin URL, and the
	 * process that builds it may be a cron job with no request to read a `Host` header from. So
	 * the origin is configuration rather than something inferred, and getting it wrong costs a
	 * notification that buzzes and then opens nothing.
	 */
	readonly publicOrigin: string;
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

function readOrigin(raw: string | undefined, host: string, port: number): string {
	if (raw === undefined || raw === "") return `http://${host}:${port}`;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`GLOOM_WATCH_ORIGIN must be an absolute URL, got ${JSON.stringify(raw)}`);
	}
	return parsed.origin;
}

/**
 * Configuration for a process that may not be systemd's child.
 *
 * `loadConfig` is deliberately pure — it reads the environment it is handed and touches no disk,
 * which is what makes it testable. But a process started by cron rather than by systemd has no
 * environment worth reading: the unit's `EnvironmentFile` was applied to the *service*, and an
 * OS-level `Bun.cron` entry is not the service's child.
 *
 * `server/push/vapid.ts` already loads the file for the VAPID secrets. That was one layer too
 * deep: it happens after configuration is read, so `GLOOM_WATCH_ORIGIN` was still missing and a
 * scheduled push would resolve its tap target to loopback — an address the phone cannot reach.
 * Found at commissioning, by running the sender with a cron-shaped environment.
 *
 * Every entry point that is not `systemd`'s child calls this. The file never overwrites a value
 * already set, so under systemd it is a no-op, and on a development machine the file is simply
 * absent.
 */
export function loadDeploymentConfig(
	env: Record<string, string | undefined> = process.env,
): ServerConfig {
	loadEnvironmentFile({ env });
	return loadConfig(env);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
	const host = env.HOST || "127.0.0.1";
	const port = readPort(env.PORT);

	return {
		databasePath: resolveFromRepo(env.GLOOM_WATCH_DB || DEFAULT_DATABASE_PATH),
		clientDir: resolveFromRepo(env.GLOOM_WATCH_CLIENT_DIR || DEFAULT_CLIENT_DIR),
		migrationsDir: resolveFromRepo(env.GLOOM_WATCH_MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR),
		host,
		port,
		defaultTimezone: env.GLOOM_WATCH_TIMEZONE || "UTC",
		publicOrigin: readOrigin(env.GLOOM_WATCH_ORIGIN, host, port),
	};
}
