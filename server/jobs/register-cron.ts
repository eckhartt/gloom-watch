import { fileURLToPath } from "node:url";

/**
 * Register the OS-level cron jobs.
 *
 * `Bun.cron(path, schedule, title)` — the three-argument form — writes a real crontab entry
 * that runs the module in its own process on schedule, surviving restarts and reboots without
 * systemd. Registration is idempotent: re-registering a title overwrites it in place, so the
 * server may run this on every boot.
 *
 * This is also why a settings screen that edits a schedule must trigger re-registration — the
 * stored value and the running crontab entry otherwise disagree silently.
 *
 * **Not runnable on macOS during development.** Run it on the deployment box; see
 * `docs/deploy.md`.
 */

export interface CronRegistration {
	/** Module file name, resolved to an absolute path against this directory before use. */
	readonly module: string;
	/** Cron expression, interpreted in the box's local time. */
	readonly schedule: string;
	/** Unique job title; re-registering the same title replaces the entry in place. */
	readonly title: string;
}

/**
 * Heartbeat plus the forward scanner. Later tickets add the two digests (`digest_times`) and
 * the backup, each as its own module and its own title. Changing `scan_interval_minutes`
 * later must re-run this, or the stored setting and the crontab silently disagree.
 */
export const CRON_REGISTRATIONS: readonly CronRegistration[] = [
	{
		module: "heartbeat.ts",
		schedule: "*/10 * * * *",
		title: "gloom-watch-heartbeat",
	},
	{
		module: "scan.ts",
		schedule: "*/10 * * * *",
		title: "gloom-watch-scan",
	},
];

/**
 * Absolute, because Bun resolves a relative job path against the caller and cron will run the
 * entry from a working directory nobody chose. An absolute path removes the question.
 */
export function resolveJobPath(module: string): string {
	return fileURLToPath(new URL(module, import.meta.url));
}

export async function registerCronJobs(
	registrations: readonly CronRegistration[] = CRON_REGISTRATIONS,
): Promise<void> {
	for (const job of registrations) {
		const path = resolveJobPath(job.module);
		await Bun.cron(path, job.schedule, job.title);
		console.log(`registered cron job ${job.title}: ${job.schedule} -> ${path}`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await registerCronJobs();
}
