import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvironmentFile, parseEnvironmentFile } from "../server/env-file.ts";
import {
	loadVapidConfig,
	readVapidPublicKey,
	VapidNotConfiguredError,
} from "../server/push/vapid.ts";

/**
 * The trap the walking skeleton left behind, closed.
 *
 * An OS-level `Bun.cron` entry is not systemd's child. It gets a near-empty environment and
 * inherits nothing from the unit's `EnvironmentFile`, so `VAPID_PRIVATE_KEY` — which is present in
 * every developer's `.env` and in the running server's environment — is simply absent when the
 * job that needs it finally runs, in production, months later.
 *
 * These tests run the sender's configuration path against an environment that has nothing in it,
 * which is the shape cron actually hands over.
 */

const SECRET = "a-private-key-that-must-never-be-logged";

describe("parsing an environment file", () => {
	it("reads systemd's KEY=value form, comments and blank lines", () => {
		expect(
			parseEnvironmentFile(
				["# a comment", "", "VAPID_SUBJECT=mailto:owner@example.org", "  PORT=3000  "].join("\n"),
			),
		).toEqual({ VAPID_SUBJECT: "mailto:owner@example.org", PORT: "3000" });
	});

	it("strips one layer of matching quotes and nothing inside them", () => {
		expect(parseEnvironmentFile(`A="one two"\nB='three'\nC="mis'matched"`)).toEqual({
			A: "one two",
			B: "three",
			C: "mis'matched",
		});
	});

	it("does not expand variables, so a secret containing $ survives", () => {
		// systemd does not expand in this file either, and a base64 secret can contain anything.
		expect(parseEnvironmentFile("K=abc$HOME/def")).toEqual({ K: "abc$HOME/def" });
	});

	it("keeps an = inside a value", () => {
		expect(parseEnvironmentFile("K=aGVsbG8=")).toEqual({ K: "aGVsbG8=" });
	});

	it("ignores lines that are not assignments", () => {
		expect(parseEnvironmentFile("no equals here\n=novalue\n1BAD=x\nexport OK=1")).toEqual({
			OK: "1",
		});
	});
});

describe("loading an environment file", () => {
	let dir: string;
	let path: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "gloom-watch-env-"));
		path = join(dir, "gloom-watch.env");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("does not overwrite a value the environment already carries", () => {
		writeFileSync(path, "PORT=9999\nHOST=1.2.3.4\n");
		const env: Record<string, string | undefined> = { PORT: "3000" };

		const load = loadEnvironmentFile({ path, env });

		expect(env.PORT).toBe("3000");
		expect(env.HOST).toBe("1.2.3.4");
		expect(load.applied).toEqual(["HOST"]);
		expect(load.skipped).toEqual(["PORT"]);
	});

	it("reports names only, never values", () => {
		writeFileSync(path, `VAPID_PRIVATE_KEY=${SECRET}\n`);
		const load = loadEnvironmentFile({ path, env: {} });

		expect(JSON.stringify(load)).not.toContain(SECRET);
	});

	it("is quiet about an absent file, which is the normal case in development", () => {
		const load = loadEnvironmentFile({ path: join(dir, "nothing-here.env"), env: {} });
		expect(load.found).toBe(false);
		expect(load.applied).toEqual([]);
	});
});

describe("the VAPID configuration a cron job would see", () => {
	let dir: string;
	let path: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "gloom-watch-vapid-"));
		path = join(dir, "gloom-watch.env");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("finds the keys in the environment file when the environment has none", () => {
		writeFileSync(
			path,
			[
				"VAPID_PUBLIC_KEY=a-public-key",
				`VAPID_PRIVATE_KEY=${SECRET}`,
				"VAPID_SUBJECT=mailto:owner@example.org",
			].join("\n"),
		);

		// Exactly what cron hands over: the file's location and nothing else.
		const env: Record<string, string | undefined> = { GLOOM_WATCH_ENV_FILE: path };
		const config = loadVapidConfig(env);

		expect(config.publicKey).toBe("a-public-key");
		expect(config.privateKey).toBe(SECRET);
		expect(config.subject).toBe("mailto:owner@example.org");
	});

	it("names what is missing without printing a value", () => {
		writeFileSync(path, "VAPID_PUBLIC_KEY=a-public-key\n");
		const env: Record<string, string | undefined> = { GLOOM_WATCH_ENV_FILE: path };

		let thrown: unknown;
		try {
			loadVapidConfig(env);
		} catch (cause) {
			thrown = cause;
		}

		expect(thrown).toBeInstanceOf(VapidNotConfiguredError);
		expect((thrown as VapidNotConfiguredError).missing).toEqual([
			"VAPID_PRIVATE_KEY",
			"VAPID_SUBJECT",
		]);
		expect((thrown as Error).message).toContain(path);
		expect((thrown as Error).message).not.toContain(SECRET);
	});

	it("refuses a subject that is not a mailto: or https: URL", () => {
		const env: Record<string, string | undefined> = {
			GLOOM_WATCH_ENV_FILE: path,
			VAPID_PUBLIC_KEY: "a-public-key",
			VAPID_PRIVATE_KEY: SECRET,
			VAPID_SUBJECT: "owner@example.org",
		};
		expect(() => loadVapidConfig(env)).toThrow(/mailto: or https:/);
	});

	it("hands out the public key alone, and reports null rather than throwing when unset", () => {
		writeFileSync(path, `VAPID_PUBLIC_KEY=a-public-key\nVAPID_PRIVATE_KEY=${SECRET}\n`);
		expect(readVapidPublicKey({ GLOOM_WATCH_ENV_FILE: path })).toBe("a-public-key");
		expect(readVapidPublicKey({ GLOOM_WATCH_ENV_FILE: join(dir, "absent.env") })).toBeNull();
	});
});
