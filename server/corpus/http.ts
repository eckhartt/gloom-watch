/**
 * The corpus HTTP surface.
 *
 * Route shapes are the builder's choice; the constraints are the spec's. The one that shapes
 * this file: **sync is a job, not a request.** `POST /api/corpus/sync` writes a job row, kicks
 * the work off and answers `202` with the job id. It never awaits the sync, so pressing the
 * button on the phone does not hold a connection open for the two minutes the work takes.
 */

import { Hono } from "hono";
import type {
	CorpusStatusDocument,
	CorpusSyncJobDocument,
	CorpusSyncStatus,
	UnknownAxisValueSummary,
} from "../../shared/contract.ts";
import { CORPUS_STATUS_PATH, CORPUS_SYNC_PATH } from "../../shared/contract.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { CorpusSyncJobRow } from "../db/schema.ts";
import {
	readActiveSyncJob,
	readCardImage,
	readCorpusTotals,
	readLastSuccessfulSyncAt,
	readLatestSyncJob,
	readSyncJob,
} from "./repository.ts";
import { beginCorpusSync } from "./sync.ts";

/** Starts the work for an already-created job. Fire and forget — it must not be awaited. */
export type CorpusSyncStarter = (jobId: string) => void;

export interface CorpusRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
	readonly startCorpusSync: CorpusSyncStarter;
}

function parseJson<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function toSyncJobDocument(row: CorpusSyncJobRow): CorpusSyncJobDocument {
	return {
		id: row.id,
		status: row.status as CorpusSyncStatus,
		phase: row.phase,
		startedAt: row.startedAt,
		updatedAt: row.updatedAt,
		finishedAt: row.finishedAt,
		processed: row.processed,
		total: row.total,
		message: row.message,
		error: row.error,
		languagesSynced: parseJson<string[]>(row.languagesSynced, []),
		cardsUpserted: row.cardsUpserted,
		variantsUpserted: row.variantsUpserted,
		cardsFlaggedMissing: row.cardsFlaggedMissing,
		variantsFlaggedMissing: row.variantsFlaggedMissing,
		imagesFetched: row.imagesFetched,
		imagesUnchanged: row.imagesUnchanged,
		imageBytesFetched: row.imageBytesFetched,
		unknownAxisValues: parseJson<UnknownAxisValueSummary[]>(row.unknownAxisValues, []),
		variantCountBefore: row.variantCountBefore,
		variantCountAfter: row.variantCountAfter,
	};
}

export function readCorpusStatus(db: GloomDatabase): CorpusStatusDocument {
	const totals = readCorpusTotals(db);
	const active = readActiveSyncJob(db);
	const latest = active ?? readLatestSyncJob(db);
	const before = latest?.variantCountBefore ?? null;
	const after = latest?.variantCountAfter ?? null;

	return {
		cards: totals.cards,
		variants: totals.variants,
		variantsMissingUpstream: totals.variantsMissingUpstream,
		languages: totals.languages,
		imagesStored: totals.imagesStored,
		imageBytes: totals.imageBytes,
		lastSyncedAt: readLastSuccessfulSyncAt(db),
		// The masterset only grows unless something went wrong. A drop is the visible form of a
		// membership regression that would otherwise raise the completion percentage in silence.
		variantCountDropped: before !== null && after !== null && after < before,
		latestJob: latest === null ? null : toSyncJobDocument(latest),
		syncRunning: active !== null,
	};
}

export function createCorpusRoutes(deps: CorpusRouteDeps): Hono {
	const routes = new Hono();

	routes.get(CORPUS_STATUS_PATH, (c) => {
		c.header("Cache-Control", "no-store");
		return c.json(readCorpusStatus(deps.db));
	});

	routes.post(CORPUS_SYNC_PATH, (c) => {
		c.header("Cache-Control", "no-store");
		const active = readActiveSyncJob(deps.db);
		if (active !== null) {
			// Two concurrent syncs would fight over the same upsert keys and double the load on a
			// free API for no gain. The running job is returned so the client can just watch it.
			return c.json({ job: toSyncJobDocument(active) }, 409);
		}
		const jobId = beginCorpusSync(deps.db, deps.now());
		deps.startCorpusSync(jobId);
		const created = readSyncJob(deps.db, jobId);
		return c.json({ job: created === null ? null : toSyncJobDocument(created) }, 202);
	});

	routes.get(`${CORPUS_SYNC_PATH}/:jobId`, (c) => {
		c.header("Cache-Control", "no-store");
		const row = readSyncJob(deps.db, c.req.param("jobId"));
		if (row === null) return c.json({ error: "no such sync job" }, 404);
		return c.json(toSyncJobDocument(row));
	});

	/**
	 * The corpus image, straight out of the BLOB column.
	 *
	 * The ETag is the `datas.json` hash, which is upstream's own content identity — so the phone
	 * revalidates against the same token the incremental sync uses, and a card whose art never
	 * changes is fetched once for the life of the install.
	 */
	routes.get("/api/corpus/cards/:cardKey/image", (c) => {
		const image = readCardImage(deps.db, c.req.param("cardKey"));
		if (image === null) return c.json({ error: "no image for that card" }, 404);

		const etag = image.hash === null ? null : `"${image.hash}"`;
		if (etag !== null && c.req.header("if-none-match") === etag) {
			c.header("ETag", etag);
			return c.body(null, 304);
		}
		c.header("Content-Type", image.contentType);
		c.header("Cache-Control", "public, max-age=31536000, immutable");
		if (etag !== null) c.header("ETag", etag);
		return c.body(new Uint8Array(image.bytes));
	});

	return routes;
}
