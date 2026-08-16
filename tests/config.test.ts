import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	DEFAULT_CLIENT_DIR,
	DEFAULT_DATABASE_PATH,
	DEFAULT_MIGRATIONS_DIR,
	loadConfig,
	loadDeploymentConfig,
	REPO_ROOT,
	resolveFromRepo,
} from "../server/config.ts";

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function environmentFileContaining(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "gloom-env-"));
	tempDirs.push(dir);
	const path = join(dir, "gloom-watch.env");
	writeFileSync(path, body);
	return path;
}

describe("configuration for a process systemd did not start", () => {
	// A cron process inherits none of the unit's EnvironmentFile. `loadConfig` reads only what it
	// is handed, so the origin was resolving to loopback and a scheduled push would have buzzed
	// the phone and then opened nothing. Found at commissioning.
	it("reads the environment file, so a cron process resolves the real origin", () => {
		const path = environmentFileContaining(
			"# the deployment's file\nGLOOM_WATCH_ORIGIN=https://htpc.tail594f35.ts.net\n",
		);
		const cronLikeEnvironment = { GLOOM_WATCH_ENV_FILE: path };

		expect(loadConfig({ ...cronLikeEnvironment }).publicOrigin).toBe("http://127.0.0.1:3000");
		expect(loadDeploymentConfig({ ...cronLikeEnvironment }).publicOrigin).toBe(
			"https://htpc.tail594f35.ts.net",
		);
	});

	it("lets the running environment win, so a one-off override is not undone", () => {
		const path = environmentFileContaining("GLOOM_WATCH_ORIGIN=https://htpc.tail594f35.ts.net\n");

		expect(
			loadDeploymentConfig({
				GLOOM_WATCH_ENV_FILE: path,
				GLOOM_WATCH_ORIGIN: "https://staging.example.net",
			}).publicOrigin,
		).toBe("https://staging.example.net");
	});

	it("is a no-op when the file is absent, which is every development machine", () => {
		expect(
			loadDeploymentConfig({ GLOOM_WATCH_ENV_FILE: join(tmpdir(), "no-such-gloom-env") })
				.publicOrigin,
		).toBe("http://127.0.0.1:3000");
	});
});

describe("configuration", () => {
	it("defaults the database under data/, which .gitignore excludes", () => {
		// The repository is public. A database sited anywhere else gets committed.
		expect(DEFAULT_DATABASE_PATH.startsWith("data/")).toBe(true);
		expect(loadConfig({}).databasePath).toBe(join(REPO_ROOT, DEFAULT_DATABASE_PATH));
	});

	it("resolves every path against the repository root, not the working directory", () => {
		// The HTTP server has a systemd WorkingDirectory; an OS-level cron job has whatever cron
		// chose. Resolving from cwd would let them open different databases in silence.
		const config = loadConfig({});
		expect(isAbsolute(config.databasePath)).toBe(true);
		expect(isAbsolute(config.clientDir)).toBe(true);
		expect(isAbsolute(config.migrationsDir)).toBe(true);
		expect(config.clientDir).toBe(join(REPO_ROOT, DEFAULT_CLIENT_DIR));
		expect(config.migrationsDir).toBe(join(REPO_ROOT, DEFAULT_MIGRATIONS_DIR));
	});

	it("leaves :memory: and absolute overrides alone", () => {
		expect(resolveFromRepo(":memory:")).toBe(":memory:");
		expect(loadConfig({ GLOOM_WATCH_DB: "/srv/gloom.db" }).databasePath).toBe("/srv/gloom.db");
	});

	it("binds loopback by default, because Tailscale Serve proxies to it", () => {
		expect(loadConfig({}).host).toBe("127.0.0.1");
		expect(loadConfig({}).port).toBe(3000);
	});

	it("rejects a nonsense port rather than falling back to one", () => {
		expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
		expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
	});

	it("takes the public origin from the environment and keeps only its origin", () => {
		// A notification's tap target is built from this, by a process that may have no HTTP
		// request to read a Host header from.
		expect(
			loadConfig({ GLOOM_WATCH_ORIGIN: "https://htpc.tail594f35.ts.net/x" }).publicOrigin,
		).toBe("https://htpc.tail594f35.ts.net");
	});

	it("falls back to the bound address, which the phone cannot reach", () => {
		// Deliberately useless as a tap target, so the failure is loud rather than a notification
		// that buzzes and opens nothing. `bun run push:test` refuses to send without the real one.
		expect(loadConfig({}).publicOrigin).toBe("http://127.0.0.1:3000");
	});

	it("rejects an origin that is not an absolute URL", () => {
		expect(() => loadConfig({ GLOOM_WATCH_ORIGIN: "htpc.tail594f35.ts.net" })).toThrow(
			/GLOOM_WATCH_ORIGIN/,
		);
	});
});
