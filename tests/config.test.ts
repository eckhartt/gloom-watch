import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_CLIENT_DIR,
	DEFAULT_DATABASE_PATH,
	DEFAULT_MIGRATIONS_DIR,
	loadConfig,
	REPO_ROOT,
	resolveFromRepo,
} from "../server/config.ts";

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
});
