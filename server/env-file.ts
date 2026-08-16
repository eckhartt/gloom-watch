import { readFileSync } from "node:fs";

/**
 * Read the deployment's environment file explicitly.
 *
 * **This exists because a scheduled job does not inherit systemd's `EnvironmentFile`.** The HTTP
 * server is started by systemd, which reads `/etc/gloom-watch/gloom-watch.env` as root and hands
 * the values to the process. An OS-level `Bun.cron` entry is not systemd's child: cron gives it a
 * near-empty environment, and every secret the unit file supplies is simply absent.
 *
 * `VAPID_PRIVATE_KEY` is exactly the secret that fails this way — silently, in production, having
 * passed every local test, because a development machine has it in a `.env` that Bun loads on its
 * own. So the push sender loads this file itself rather than trusting its caller to have done it;
 * see `server/push/vapid.ts`. Any later job wanting `EBAY_CLIENT_SECRET` or
 * `RELIST_HASH_SALT` should do the same.
 *
 * **Nothing here ever logs a value.** The returned report carries variable *names* only.
 */

/** Where the deployment keeps it. `docs/deploy.md` installs it there. */
export const DEFAULT_ENV_FILE = "/etc/gloom-watch/gloom-watch.env";

export function environmentFilePath(env: Record<string, string | undefined> = process.env): string {
	return env.GLOOM_WATCH_ENV_FILE || DEFAULT_ENV_FILE;
}

/**
 * systemd's `EnvironmentFile` format, minus the parts nothing here uses: `KEY=value` a line,
 * `#` comments, blank lines ignored, one optional layer of matching quotes stripped. No variable
 * expansion — systemd does not do it in this file either, and a secret containing a `$` must
 * survive untouched.
 */
export function parseEnvironmentFile(text: string): Record<string, string> {
	const values: Record<string, string> = {};

	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
		const separator = withoutExport.indexOf("=");
		if (separator <= 0) continue;

		const key = withoutExport.slice(0, separator).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = withoutExport.slice(separator + 1).trim();
		if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
			const quote = value[0] as string;
			if (value.endsWith(quote)) value = value.slice(1, -1);
		}
		values[key] = value;
	}

	return values;
}

export interface EnvironmentFileLoad {
	readonly path: string;
	/** False when the file is simply not there — the normal case on a development machine. */
	readonly found: boolean;
	/** Names of the variables this call set. Never their values. */
	readonly applied: readonly string[];
	/** Names present in the file but already set in the environment, which wins. */
	readonly skipped: readonly string[];
}

export interface LoadEnvironmentFileOptions {
	readonly path?: string;
	readonly env?: Record<string, string | undefined>;
	/** Fail loudly if the file is absent. The push sender uses this when a key is missing. */
	readonly required?: boolean;
}

/**
 * Merge the file into `env` without overwriting anything already there.
 *
 * The running environment wins on purpose: under systemd the unit has already applied this same
 * file, and a value overridden at the command line for a one-off run must not be quietly undone.
 */
export function loadEnvironmentFile(options: LoadEnvironmentFileOptions = {}): EnvironmentFileLoad {
	const env = options.env ?? process.env;
	const path = options.path ?? environmentFilePath(env);

	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		if (code === "ENOENT" && options.required !== true) {
			return { path, found: false, applied: [], skipped: [] };
		}
		if (code === "EACCES") {
			throw new Error(
				`cannot read ${path}: permission denied. A scheduled job runs as the service account, ` +
					"not as root, so the environment file must be root:gloom mode 0640 — see docs/deploy.md.",
				{ cause },
			);
		}
		throw new Error(`cannot read the environment file ${path}`, { cause });
	}

	const applied: string[] = [];
	const skipped: string[] = [];
	for (const [key, value] of Object.entries(parseEnvironmentFile(text))) {
		if (env[key] !== undefined && env[key] !== "") {
			skipped.push(key);
			continue;
		}
		env[key] = value;
		applied.push(key);
	}

	return { path, found: true, applied, skipped };
}
