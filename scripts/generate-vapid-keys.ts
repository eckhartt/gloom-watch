/**
 * Generate the VAPID keypair. Once, ever.
 *
 * **Rotating this keypair invalidates every existing subscription.** Every `PushSubscription` the
 * phone ever took was created against a specific application server key; the next send after a
 * rotation comes back `400 VapidPkHashMismatch`, and the only recovery is a tap on the device to
 * re-subscribe. So this script refuses to overwrite an existing key unless told to in words.
 *
 * The private key is **written to a file and never printed**. The public key is printed, because
 * the client needs it and it is public by construction.
 *
 *   bun run vapid:generate                    # writes ./.env, which .gitignore excludes
 *   bun run vapid:generate --out path.env
 *   bun run vapid:generate --subject mailto:you@example.org
 *   bun run vapid:generate --force            # rotate, understanding the cost above
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { parseEnvironmentFile } from "../server/env-file.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function flag(name: string): string | null {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return null;
	return process.argv[index + 1] ?? "";
}

const force = process.argv.includes("--force");
const outPath = resolve(REPO_ROOT, flag("out") || ".env");
const subject = flag("subject") || "mailto:gloom-watch@localhost";

const existing = existsSync(outPath) ? parseEnvironmentFile(readFileSync(outPath, "utf8")) : {};

if ((existing.VAPID_PRIVATE_KEY ?? "") !== "" && !force) {
	console.error(
		[
			`${outPath} already carries a VAPID keypair.`,
			"",
			"Rotating it returns 400 VapidPkHashMismatch on the next send and invalidates every",
			"subscription for the origin; recovery needs a tap on the device. If that is genuinely",
			"what you want, re-run with --force.",
		].join("\n"),
	);
	process.exit(1);
}

const keys = webpush.generateVAPIDKeys();
const merged = {
	...existing,
	VAPID_PUBLIC_KEY: keys.publicKey,
	VAPID_PRIVATE_KEY: keys.privateKey,
	VAPID_SUBJECT: existing.VAPID_SUBJECT || subject,
};

const body = [
	"# Gloom Watch — local development environment. Never committed; .gitignore excludes it.",
	"# The VAPID keypair below was generated once. Rotating it kills every push subscription.",
	"",
	...Object.entries(merged).map(([key, value]) => `${key}=${value}`),
	"",
].join("\n");

writeFileSync(outPath, body, { mode: 0o600 });

// The public key, and nothing else. The private key is in the file and stays there.
console.log(
	[
		`VAPID keypair written to ${outPath} (mode 0600).`,
		"",
		`VAPID_PUBLIC_KEY=${merged.VAPID_PUBLIC_KEY}`,
		`VAPID_SUBJECT=${merged.VAPID_SUBJECT}`,
		"",
		"VAPID_PRIVATE_KEY is in that file and is deliberately not printed here. Copy it into",
		"/etc/gloom-watch/gloom-watch.env on the box — see docs/deploy.md — and do not put it in a",
		"ticket, a commit, a log line or a chat message.",
	].join("\n"),
);
