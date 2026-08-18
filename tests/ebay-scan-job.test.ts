import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The scanner module an OS-level `Bun.cron` entry runs in its own process. Registration
 * itself needs the deployment box; the handler's behaviour does not.
 *
 * `pool: "forks"` gives this file its own process, which is what makes setting the
 * environment before importing the module safe.
 */
const dir = mkdtempSync(join(tmpdir(), "gloom-watch-scan-job-"));
process.env.GLOOM_WATCH_DB = join(dir, "gloom-watch.db");
delete process.env.GLOOM_WATCH_MIGRATIONS_DIR;
delete process.env.EBAY_CLIENT_ID;
delete process.env.EBAY_CLIENT_SECRET;
delete process.env.RELIST_HASH_SALT;
delete process.env.GLOOM_WATCH_ENV_FILE;

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("the OS-level cron scanner", () => {
	it("no-ops without credentials rather than crashing the crontab", async () => {
		const { default: scan } = await import("../server/jobs/scan.ts");

		await scan.scheduled({
			cron: "*/10 * * * *",
			type: "scheduled",
			scheduledTime: 1_800_000_000_000,
		} as Bun.CronController);

		// The job must not even open a database when it cannot talk to eBay — a crash-looping
		// cron would hide the heartbeat. No file should have been created.
		expect(existsSync(process.env.GLOOM_WATCH_DB as string)).toBe(false);
	});
});
