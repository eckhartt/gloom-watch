import { loadEnvironmentFile } from "../env-file.ts";

/**
 * The eBay application identity and the relist-hash salt.
 *
 * Client-credentials OAuth — no refresh token, no browser round trip. That is what makes an
 * unattended box possible. The salt is a secret for the same reason the VAPID private key is:
 * lose it on restore and every stored `seller_hash` stops matching newly observed ones.
 *
 * Loaded the same way VAPID is: a cron process does not inherit systemd's `EnvironmentFile`,
 * so this module reads the file itself rather than trusting its caller.
 */

export const PRODUCTION_API_ROOT = "https://api.ebay.com";
export const SANDBOX_API_ROOT = "https://api.sandbox.ebay.com";

export interface EbayCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly relistHashSalt: string;
	readonly apiRoot: string;
}

export class EbayNotConfiguredError extends Error {
	readonly missing: readonly string[];

	constructor(missing: readonly string[], envFilePath: string) {
		super(
			`eBay is not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
				`not set in the environment and were not found in ${envFilePath}. ` +
				"A production keyset belongs in the environment file; see docs/deploy.md.",
		);
		this.name = "EbayNotConfiguredError";
		this.missing = missing;
	}
}

const REQUIRED = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "RELIST_HASH_SALT"] as const;

function missingKeys(env: Record<string, string | undefined>): string[] {
	return REQUIRED.filter((key) => (env[key] ?? "") === "");
}

export function ensureEbayEnvironment(env: Record<string, string | undefined> = process.env): void {
	if (missingKeys(env).length === 0) return;
	loadEnvironmentFile({ env });
}

function resolveApiRoot(env: Record<string, string | undefined>): string {
	if (env.EBAY_API_ROOT !== undefined && env.EBAY_API_ROOT !== "") {
		return env.EBAY_API_ROOT.replace(/\/$/, "");
	}
	return env.EBAY_ENV === "sandbox" ? SANDBOX_API_ROOT : PRODUCTION_API_ROOT;
}

/** Throws `EbayNotConfiguredError` if anything is missing. Never reports a value. */
export function loadEbayCredentials(
	env: Record<string, string | undefined> = process.env,
): EbayCredentials {
	ensureEbayEnvironment(env);

	const missing = missingKeys(env);
	if (missing.length > 0) {
		throw new EbayNotConfiguredError(missing, env.GLOOM_WATCH_ENV_FILE ?? "the environment file");
	}

	return {
		clientId: env.EBAY_CLIENT_ID as string,
		clientSecret: env.EBAY_CLIENT_SECRET as string,
		relistHashSalt: env.RELIST_HASH_SALT as string,
		apiRoot: resolveApiRoot(env),
	};
}

/** `null` rather than a throw, for the cron job that should log and exit when unset. */
export function tryLoadEbayCredentials(
	env: Record<string, string | undefined> = process.env,
): EbayCredentials | null {
	try {
		return loadEbayCredentials(env);
	} catch (error) {
		if (error instanceof EbayNotConfiguredError) return null;
		throw error;
	}
}
