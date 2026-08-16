import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { APP_STATE_KEYS, readAppStateNumber } from "../server/db/app-state.ts";
import { openDatabase } from "../server/db/client.ts";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";

/**
 * The heartbeat is the module an OS-level `Bun.cron` entry runs in its own process. Registration
 * itself needs the deployment box; the handler's behaviour does not, so it is tested here.
 *
 * `pool: "forks"` gives this file its own process, which is what makes setting the environment
 * before importing the module safe.
 */
const dir = mkdtempSync(join(tmpdir(), "gloom-watch-heartbeat-"));
process.env.GLOOM_WATCH_DB = join(dir, "gloom-watch.db");
// Left unset deliberately: the job must find the committed migrations from its own module
// location, because cron gives it a working directory nobody chose.
delete process.env.GLOOM_WATCH_MIGRATIONS_DIR;

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("the OS-level cron heartbeat", () => {
	it("migrates a database it finds empty, then writes its scheduled time", async () => {
		const { default: heartbeat } = await import("../server/jobs/heartbeat.ts");

		const scheduledTime = 1_786_800_000_000;
		heartbeat.scheduled({
			cron: "*/10 * * * *",
			type: "scheduled",
			scheduledTime,
		} as Bun.CronController);

		// A *separate* connection, as the HTTP server's process would have. This is the property
		// WAL and `busy_timeout` exist to provide: the job writes, the server reads, no
		// coordination between them beyond SQLite.
		const reader = openDatabase(process.env.GLOOM_WATCH_DB as string);
		try {
			expect(readAppStateNumber(reader.db, APP_STATE_KEYS.lastHeartbeatAt)).toBe(scheduledTime);

			const response = await createApp({
				handle: reader,
				clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			}).request(HEALTH_PATH);
			const body = (await response.json()) as HealthDocument;
			expect(body.lastHeartbeatAt).toBe(scheduledTime);
			expect(body.migrationsApplied).toBe(1);
		} finally {
			reader.close();
		}
	});
});
