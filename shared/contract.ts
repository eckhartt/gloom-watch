/**
 * The wire contract between server and client. `shared/` is compiled into both TypeScript
 * projects, so a change here breaks whichever side has not caught up.
 *
 * Per the spec's conventions: every stored instant is UTC epoch milliseconds. Calendar dates
 * that are not instants are ISO `YYYY-MM-DD` strings; none appear yet.
 */

/** Path of the health document. */
export const HEALTH_PATH = "/api/health";

/** Corpus status: totals, the last successful sync, and whatever job is running now. */
export const CORPUS_STATUS_PATH = "/api/corpus/status";

/** `POST` starts a sync and returns immediately with the job id. Never blocks on the work. */
export const CORPUS_SYNC_PATH = "/api/corpus/sync";

/** `GET /api/corpus/sync/{id}` — one job document, for polling progress. */
export function corpusSyncJobPath(jobId: string): string {
	return `${CORPUS_SYNC_PATH}/${encodeURIComponent(jobId)}`;
}

/**
 * `GET /api/corpus/cards/{cardKey}/image` — the stored webp BLOB.
 *
 * `cardKey` is `{language}:{cardId}` and carries a colon, so it is path-encoded at both ends.
 */
export function corpusCardImagePath(cardKey: string): string {
	return `/api/corpus/cards/${encodeURIComponent(cardKey)}/image`;
}

/**
 * Server-side health state. The spec fixes this as *server-side state only* — the outbox
 * pending count is client state and is surfaced by the client, because the server cannot
 * know it. Later tickets add last-scan-per-marketplace and last-verified-backup here.
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
	/** UTC epoch ms of the last sync that finished cleanly; `null` before the first one. */
	readonly corpusLastSyncedAt: number | null;
	/** Variants held. The masterset's size, and the denominator's raw material. */
	readonly corpusVariantCount: number;
	/** UTC epoch ms at the moment the request was served. */
	readonly serverTimeMs: number;
}

export type CorpusSyncStatus = "running" | "succeeded" | "failed" | "interrupted";

/**
 * One sync job. This is the observable progress the spec requires of a long-running job, and it
 * is durable: it is a database row, so a restart leaves a job marked `interrupted` rather than
 * one that claims to be running forever.
 */
export interface CorpusSyncJobDocument {
	readonly id: string;
	readonly status: CorpusSyncStatus;
	/** `languages` | `brief` | `detail` | `images` | `reconcile` | `done`. */
	readonly phase: string;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly finishedAt: number | null;
	readonly processed: number;
	/** `null` until the running phase knows its own size. */
	readonly total: number | null;
	readonly message: string | null;
	readonly error: string | null;
	readonly languagesSynced: readonly string[];
	readonly cardsUpserted: number;
	readonly variantsUpserted: number;
	readonly cardsFlaggedMissing: number;
	readonly variantsFlaggedMissing: number;
	readonly imagesFetched: number;
	readonly imagesUnchanged: number;
	readonly imageBytesFetched: number;
	/** Axis values that canonicalised outside the known vocabulary — a new localisation, usually. */
	readonly unknownAxisValues: readonly UnknownAxisValueSummary[];
	readonly variantCountBefore: number | null;
	readonly variantCountAfter: number | null;
}

export interface UnknownAxisValueSummary {
	readonly axis: string;
	readonly raw: string;
	readonly canonical: string;
	readonly count: number;
}

/**
 * What the corpus holds and when it was last filled.
 *
 * `variantCountDropped` exists because completion has no oracle: a membership regression that
 * silently drops rows shrinks the denominator and makes the percentage go *up*, with every test
 * still green. Comparing the count across syncs turns that into something visible.
 */
export interface CorpusStatusDocument {
	readonly cards: number;
	readonly variants: number;
	readonly variantsMissingUpstream: number;
	readonly languages: number;
	readonly imagesStored: number;
	readonly imageBytes: number;
	readonly lastSyncedAt: number | null;
	readonly variantCountDropped: boolean;
	/** The job running right now, or the most recent one when nothing is running. */
	readonly latestJob: CorpusSyncJobDocument | null;
	readonly syncRunning: boolean;
}
