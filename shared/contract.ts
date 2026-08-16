/**
 * The wire contract between server and client. `shared/` is compiled into both TypeScript
 * projects, so a change here breaks whichever side has not caught up.
 *
 * Per the spec's conventions: every stored instant is UTC epoch milliseconds. Calendar dates
 * that are not instants are ISO `YYYY-MM-DD` strings; none appear yet.
 */

/** Path of the health document. The client has no other endpoint yet. */
export const HEALTH_PATH = "/api/health";

/**
 * Server-side health state. The spec fixes this as *server-side state only* — the outbox
 * pending count is client state and is surfaced by the client, because the server cannot
 * know it. Later tickets add last-scan-per-marketplace, last-verified-backup and
 * corpus-last-synced here.
 */
export interface HealthDocument {
	/** Constant, so a stray reverse proxy answering instead of us is obvious. */
	readonly service: "gloom-watch";
	/** IANA name, set at commissioning. Read from the database, not from the environment. */
	readonly timezone: string;
	/** UTC epoch ms; when this database was first opened by the server. */
	readonly installedAt: number | null;
	/** UTC epoch ms; written by the OS-level cron job, so `null` until it has run once. */
	readonly lastHeartbeatAt: number | null;
	/** How many Drizzle migrations this database has applied. Proves the migration ran. */
	readonly migrationsApplied: number;
	/** UTC epoch ms at the moment the request was served. */
	readonly serverTimeMs: number;
}
