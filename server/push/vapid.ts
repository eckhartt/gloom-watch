import { loadEnvironmentFile } from "../env-file.ts";

/**
 * The VAPID identity, read from the environment — and, when the environment does not have it,
 * from the deployment's environment file.
 *
 * **The keypair is generated once and never rotated casually.** Rotating it means every existing
 * subscription was taken out against a public key the server no longer holds; Apple answers the
 * next send with `400 VapidPkHashMismatch` and every subscription for the origin is dead until
 * the owner taps re-enable on the device. `bun run vapid:generate` refuses to overwrite an
 * existing key for that reason.
 *
 * **The private key is never logged.** Not at boot, not in an error, not in a health document.
 * The only thing that leaves this module with the key in it is the `Authorization` header
 * `web-push` computes, and that is a signature rather than the key.
 */

export interface VapidConfig {
	readonly publicKey: string;
	readonly privateKey: string;
	/** A `mailto:` or `https:` URL. Required in the JWT; Apple rejects a request without one. */
	readonly subject: string;
}

export class VapidNotConfiguredError extends Error {
	/** Names of the variables that were missing. Names only — never values. */
	readonly missing: readonly string[];

	constructor(missing: readonly string[], envFilePath: string) {
		super(
			`web push is not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
				`not set in the environment and were not found in ${envFilePath}. ` +
				"Generate a keypair once with `bun run vapid:generate` and place it in the environment " +
				"file; see docs/deploy.md.",
		);
		this.name = "VapidNotConfiguredError";
		this.missing = missing;
	}
}

const REQUIRED = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

function missingKeys(env: Record<string, string | undefined>): string[] {
	return REQUIRED.filter((key) => (env[key] ?? "") === "");
}

/**
 * Ensure the VAPID variables are present, loading the environment file if they are not.
 *
 * This is the guard against the trap the walking skeleton left behind: a cron-run process gets a
 * minimal environment and inherits nothing from systemd's `EnvironmentFile`. Putting the load
 * here rather than in each caller means a later digest job cannot forget it.
 */
export function ensureVapidEnvironment(
	env: Record<string, string | undefined> = process.env,
): void {
	if (missingKeys(env).length === 0) return;
	loadEnvironmentFile({ env });
}

/** `null` rather than a throw, for the cron job that should log and skip when unset. */
export function tryLoadVapidConfig(
	env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
	try {
		return loadVapidConfig(env);
	} catch (error) {
		if (error instanceof VapidNotConfiguredError) return null;
		throw error;
	}
}

/** Throws `VapidNotConfiguredError` if anything is missing. Never reports a value. */
export function loadVapidConfig(
	env: Record<string, string | undefined> = process.env,
): VapidConfig {
	ensureVapidEnvironment(env);

	const missing = missingKeys(env);
	if (missing.length > 0) {
		throw new VapidNotConfiguredError(missing, env.GLOOM_WATCH_ENV_FILE ?? "the environment file");
	}

	const subject = env.VAPID_SUBJECT as string;
	if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
		throw new Error(
			`VAPID_SUBJECT must be a mailto: or https: URL, got ${JSON.stringify(subject)}; Apple ` +
				"rejects a JWT without a usable subject claim.",
		);
	}

	return {
		publicKey: env.VAPID_PUBLIC_KEY as string,
		privateKey: env.VAPID_PRIVATE_KEY as string,
		subject,
	};
}

/**
 * The public half only, for `GET /api/push/config`. Null rather than an exception when the
 * environment is not set up: the client renders "not configured" instead of a broken page.
 *
 * There is no counterpart for the private key and there must never be one.
 */
export function readVapidPublicKey(
	env: Record<string, string | undefined> = process.env,
): string | null {
	ensureVapidEnvironment(env);
	const key = env.VAPID_PUBLIC_KEY ?? "";
	return key === "" ? null : key;
}
