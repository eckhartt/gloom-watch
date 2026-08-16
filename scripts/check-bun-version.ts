/**
 * The spec pins Bun exactly (`Runtime is Bun 1.3.14 stable`, 01m04je8az). `packageManager`
 * and `.bun-version` record the intent, but nothing in Bun enforces it at install time, so
 * this runs from `preinstall` and fails loudly rather than letting a different runtime
 * produce a lockfile nobody can reproduce.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const expected = readFileSync(join(repoRoot, ".bun-version"), "utf8").trim();

// `Bun` is absent when this file is run under Node, which is itself a failure worth naming.
const actual = typeof Bun === "undefined" ? null : Bun.version;

if (actual === null) {
	console.error(
		`gloom-watch requires Bun ${expected}, but this script is not running under Bun at all.`,
	);
	process.exit(1);
}

if (actual !== expected) {
	console.error(
		[
			`gloom-watch is pinned to Bun ${expected}; this is Bun ${actual}.`,
			`Install the pinned runtime:  curl -fsSL https://bun.sh/install | bash -s "bun-v${expected}"`,
		].join("\n"),
	);
	process.exit(1);
}

console.log(`Bun ${actual} matches the pinned version.`);
