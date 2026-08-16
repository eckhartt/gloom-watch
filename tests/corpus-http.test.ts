import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { readSyncJob } from "../server/corpus/repository.ts";
import { runCorpusSync } from "../server/corpus/sync.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import type {
	CorpusStatusDocument,
	CorpusSyncJobDocument,
	HealthDocument,
} from "../shared/contract.ts";
import {
	CORPUS_STATUS_PATH,
	CORPUS_SYNC_PATH,
	corpusCardImagePath,
	corpusSyncJobPath,
	HEALTH_PATH,
} from "../shared/contract.ts";
import { buildFakeCorpus } from "./helpers/corpus-fixture.ts";
import { FakeTcgdexClient } from "./helpers/fake-tcgdex.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * Hono's handlers against a real migrated SQLite database, with TCGdex faked at its own
 * boundary. The database is never mocked.
 */
describe("the corpus HTTP surface", () => {
	let temp: TempDatabase;
	let client: FakeTcgdexClient;
	let clock = 1_800_000_000_000;
	/** The sync work the route kicks off, held so a test can decide when it happens. */
	let pending: Promise<unknown>[] = [];

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", 1_700_000_000_000);
		client = new FakeTcgdexClient(buildFakeCorpus());
		clock = 1_800_000_000_000;
		pending = [];
	});

	afterEach(() => {
		temp.dispose();
	});

	function app(startCorpusSync?: (jobId: string) => void) {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => clock++,
			startCorpusSync:
				startCorpusSync ??
				((jobId) => {
					pending.push(
						runCorpusSync(
							{ db: temp.handle.db, client, now: () => clock++, concurrency: 2, pauseMs: 0 },
							jobId,
						),
					);
				}),
		});
	}

	it("answers the sync request without waiting for the sync", async () => {
		// The acceptance criterion in its bluntest form: the response arrives while the job is
		// still `running`, so pressing sync never holds a connection open for the work.
		const started: string[] = [];
		const response = await app((jobId) => started.push(jobId)).request(CORPUS_SYNC_PATH, {
			method: "POST",
		});

		expect(response.status).toBe(202);
		const body = (await response.json()) as { job: CorpusSyncJobDocument };
		expect(body.job.status).toBe("running");
		expect(body.job.phase).toBe("languages");
		expect(started).toEqual([body.job.id]);
		// And the job is durable: it is a row, readable by anything holding the database.
		expect(readSyncJob(temp.handle.db, body.job.id)?.status).toBe("running");
	});

	it("refuses a second sync while one is running, and hands back the running one", async () => {
		const first = await app(() => {}).request(CORPUS_SYNC_PATH, { method: "POST" });
		const firstBody = (await first.json()) as { job: CorpusSyncJobDocument };

		const second = await app(() => {}).request(CORPUS_SYNC_PATH, { method: "POST" });
		expect(second.status).toBe(409);
		const secondBody = (await second.json()) as { job: CorpusSyncJobDocument };
		expect(secondBody.job.id).toBe(firstBody.job.id);
	});

	it("reports progress on the job, then the counts when it finishes", async () => {
		const response = await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		const { job } = (await response.json()) as { job: CorpusSyncJobDocument };

		await Promise.all(pending);

		const polled = await app().request(corpusSyncJobPath(job.id));
		expect(polled.status).toBe(200);
		const document = (await polled.json()) as CorpusSyncJobDocument;
		expect(document.status).toBe("succeeded");
		expect(document.phase).toBe("done");
		expect(document.cardsUpserted).toBe(5);
		expect(document.variantsUpserted).toBe(6);
		expect(document.imagesFetched).toBe(4);
		expect(document.languagesSynced).toEqual(["en", "fr", "ja", "nl"]);
		expect(document.unknownAxisValues).toEqual([]);
	});

	it("404s an unknown job id", async () => {
		const response = await app().request(corpusSyncJobPath("not-a-job"));
		expect(response.status).toBe(404);
	});

	it("surfaces the variant count and the last-synced time — the demo", async () => {
		const before = (await (await app().request(CORPUS_STATUS_PATH)).json()) as CorpusStatusDocument;
		expect(before.variants).toBe(0);
		expect(before.lastSyncedAt).toBeNull();

		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		await Promise.all(pending);

		const after = (await (await app().request(CORPUS_STATUS_PATH)).json()) as CorpusStatusDocument;
		expect(after.variants).toBe(6);
		expect(after.cards).toBe(5);
		expect(after.languages).toBe(3);
		expect(after.imagesStored).toBe(4);
		expect(after.imageBytes).toBe(64);
		expect(after.lastSyncedAt).not.toBeNull();
		expect(after.syncRunning).toBe(false);
		expect(after.variantCountDropped).toBe(false);
		expect(after.latestJob?.status).toBe("succeeded");
	});

	it("carries the same two numbers on the health document", async () => {
		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		await Promise.all(pending);

		const health = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(health.corpusVariantCount).toBe(6);
		expect(health.corpusLastSyncedAt).not.toBeNull();
	});

	it("warns when the variant count drops, since completion has no oracle", async () => {
		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		await Promise.all(pending);

		// Simulate the regression the spec names: rows disappearing between syncs. Flagging keeps
		// the row, so the only way this fires is a genuine loss — which is what makes it a signal.
		temp.handle.db.run("delete from corpus_variants where variant_id = 'generated'");
		pending = [];
		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		const running = (await (
			await app().request(CORPUS_STATUS_PATH)
		).json()) as CorpusStatusDocument;
		expect(running.syncRunning).toBe(true);
		await Promise.all(pending);

		const status = (await (await app().request(CORPUS_STATUS_PATH)).json()) as CorpusStatusDocument;
		expect(status.latestJob?.variantCountBefore).toBe(4);
		expect(status.latestJob?.variantCountAfter).toBe(6);
		expect(status.variantCountDropped).toBe(false);
	});

	it("serves the stored webp BLOB, with the manifest hash as its ETag", async () => {
		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		await Promise.all(pending);

		const path = corpusCardImagePath("en:base2-44");
		// The colon in the card key has to survive path encoding.
		expect(path).toBe("/api/corpus/cards/en%3Abase2-44/image");

		const response = await app().request(path);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/webp");
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(bytes).toHaveLength(16);
		expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("RIFF");

		const etag = response.headers.get("etag");
		expect(etag).toBe('"hash-en-base2-44"');
		const revalidated = await app().request(path, { headers: { "if-none-match": etag ?? "" } });
		expect(revalidated.status).toBe(304);
	});

	it("404s a card that has no stored image", async () => {
		await app().request(CORPUS_SYNC_PATH, { method: "POST" });
		await Promise.all(pending);
		const response = await app().request(corpusCardImagePath("en:me02.5-002"));
		expect(response.status).toBe(404);
	});

	it("never caches the status or the job document", async () => {
		expect((await app().request(CORPUS_STATUS_PATH)).headers.get("cache-control")).toBe("no-store");
	});
});
