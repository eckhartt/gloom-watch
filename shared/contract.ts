/**
 * The wire contract between server and client. `shared/` is compiled into both TypeScript
 * projects, so a change here breaks whichever side has not caught up.
 *
 * Per the spec's conventions: every stored instant is UTC epoch milliseconds. Calendar dates
 * that are not instants are ISO `YYYY-MM-DD` strings — a set's release date is one, and is the
 * first of them to reach the wire. It must never be turned into an epoch on either side.
 */

import type { ScanHealth } from "./listings.ts";

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
 * `GET /api/binder` — every variant in the masterset, with its ownership state, in **one
 * unpaginated document**.
 *
 * One request, cacheable, never paginated: that is what makes offline browsing work and what
 * makes client-side filtering possible in a later ticket. ~765 entries, a couple of hundred
 * kilobytes. Paginating it would take both of those away and buy nothing at this size.
 */
export const BINDER_PATH = "/api/binder";

/**
 * The key that identifies one binder entry — `(card_key, variant_id)`, composed.
 *
 * **`variant_id` is not unique and using it alone silently collapses the grid.** In the live
 * corpus 817 variants carry 21 distinct `variant_id`s; the most-shared is held by 264 different
 * cards and the literal string `"generated"` by 106. A React `key` of `variant_id` would render
 * 21 cells and lose 796 without an error anywhere. This lives in the contract, rather than being
 * composed on each side, so that server and client cannot compose it differently.
 *
 * The separator is a space: neither a TCGdex card ID nor a variant token contains one.
 */
export function binderEntryKey(cardKey: string, variantId: string): string {
	return `${cardKey} ${variantId}`;
}

/**
 * One cell of the binder: a print variant, in one language, with everything the grid and the
 * sheet need and nothing else.
 *
 * Set name and release date are repeated on every entry rather than normalised into a lookup.
 * At 765 entries the duplication is a few kilobytes before compression, and it means the client
 * sorts, renders and — later — filters without a join it could get wrong.
 */
export interface BinderEntry {
	/** `binderEntryKey(cardKey, variantId)`. The React key. Never use `variantId` for this. */
	readonly key: string;
	/** `{language}:{card_id}`. Carries a colon, so it is path-encoded in any URL. */
	readonly cardKey: string;
	/** Opaque, never parsed, **not unique on its own**. */
	readonly variantId: string;
	readonly language: string;
	readonly setId: string;
	readonly setName: string | null;
	/**
	 * ISO `YYYY-MM-DD`, or null when the set has no date upstream. A calendar date, not an
	 * instant — do not turn it into an epoch. Entries are ordered on it, nulls last.
	 */
	readonly setReleaseDate: string | null;
	/** The card number as printed. Not always numeric: `SH3`, `XY99`, `H31` are all real. */
	readonly localId: string;
	readonly name: string;
	readonly rarity: string | null;
	/** The five axes, canonicalised. `stamps` is a sorted list; the rest are scalars. */
	readonly finish: string | null;
	readonly subtype: string | null;
	readonly stamps: readonly string[];
	readonly foil: string | null;
	readonly size: string | null;
	/** Whether the *card* holds an image BLOB. Several variants share one card image. */
	readonly hasImage: boolean;
	/** Flagged, not deleted, when upstream stopped carrying it. A completion-denominator input. */
	readonly missingUpstream: boolean;
	/**
	 * How many copies at `status = 'owned'` point at this variant. `0` means needed.
	 *
	 * A count rather than a boolean because a PSA 9 and a raw copy of one variant are two rows.
	 * Disposed copies are not counted here — they keep their rows so the purchase history
	 * survives, and counting them would say the owner holds a card they sold.
	 */
	readonly ownedCopies: number;
	/**
	 * The owner's 0–3 ranking of a variant they do not hold, or `null` when unset.
	 *
	 * It rides on the binder document rather than being fetched per variant because the sheet has
	 * to render it the instant it opens, offline included — the same reason ownership rides here.
	 * It belongs to the variant and not to a copy: by definition there is no copy to hang it on.
	 */
	readonly priority: number | null;
}

/**
 * The binder, whole.
 *
 * There is deliberately **no completion figure here**. The spec says how completion is presented
 * numerically is still undecided, and the ticket forbids an aggregate above the grid. What the
 * document carries is the completion *inputs* — `ownedCopies` and `missingUpstream` per entry —
 * from which any presentation can be computed once one is chosen.
 */
export interface BinderDocument {
	/** UTC epoch ms at which the server built this document. */
	readonly generatedAt: number;
	/** Ordered: set release date descending, nulls last, then set, then card number. */
	readonly entries: readonly BinderEntry[];
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
	/** Per-marketplace cursors and the day's call spend. Present even before the first scan. */
	readonly scan: ScanHealth;
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
	/** `languages` | `brief` | `detail` | `sets` | `images` | `reconcile` | `done`. */
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
	/** Sets asked about this run. 137 on a first sync; 0 on a re-sync that found nothing new. */
	readonly setsFetched: number;
	/** Sets the corpus references and already held a release date for, so never asked about. */
	readonly setsUnchanged: number;
	readonly setsFlaggedMissing: number;
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
	/** `(language, set)` pairs held. Where the binder's release dates come from. */
	readonly sets: number;
	/**
	 * Sets held with no release date. The binder orders those last, so a number climbing here is
	 * the visible form of an ordering that has quietly stopped meaning anything.
	 */
	readonly setsWithoutReleaseDate: number;
	readonly imagesStored: number;
	readonly imageBytes: number;
	readonly lastSyncedAt: number | null;
	readonly variantCountDropped: boolean;
	/** The job running right now, or the most recent one when nothing is running. */
	readonly latestJob: CorpusSyncJobDocument | null;
	readonly syncRunning: boolean;
}
