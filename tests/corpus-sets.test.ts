import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCorpusTotals } from "../server/corpus/repository.ts";
import { beginCorpusSync, type CorpusSyncSummary, runCorpusSync } from "../server/corpus/sync.ts";
import { corpusSets } from "../server/db/schema.ts";
import { buildFakeCorpus } from "./helpers/corpus-fixture.ts";
import { type FakeCorpus, FakeTcgdexClient } from "./helpers/fake-tcgdex.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The sets phase, driven end to end against a real database with TCGdex faked at its HTTP
 * boundary.
 *
 * This phase exists for one field. The binder's default order is set release date descending and
 * **nothing else in the corpus carries the date** — not the card payload's `set` object, not the
 * set list, not the series endpoint. `/v2/{lang}/sets/{setId}` carries it one set at a time, so
 * the cost of the ordering is one request per set, and the tests below are mostly about not
 * paying that cost twice.
 */
describe("the sets phase", () => {
	let temp: TempDatabase;
	let corpus: FakeCorpus;
	let client: FakeTcgdexClient;
	let clock = 1_800_000_000_000;

	beforeEach(() => {
		temp = createTempDatabase();
		corpus = buildFakeCorpus();
		client = new FakeTcgdexClient(corpus);
		clock = 1_800_000_000_000;
	});

	afterEach(() => {
		temp.dispose();
	});

	async function sync(): Promise<CorpusSyncSummary> {
		const jobId = beginCorpusSync(temp.handle.db, clock);
		return await runCorpusSync(
			{ db: temp.handle.db, client, now: () => clock++, concurrency: 2, pauseMs: 0 },
			jobId,
		);
	}

	function setRows() {
		return temp.handle.db.select().from(corpusSets).all();
	}

	it("asks about every (language, set) the detail phase landed on, and no others", async () => {
		// The count is the whole argument for doing this as a sync phase: it is one request per
		// set the corpus *references*, not per set × language upstream carries. Against the live
		// corpus that is 137 requests rather than the 506 a cross-product would suggest.
		await sync();

		expect(client.setRequests.sort()).toEqual([
			"en|base1",
			"en|base2",
			"en|me02.5",
			"fr|base2",
			"ja|SV3",
		]);
		// TCG Pocket never reached the cards table, so its set is never asked about either.
		expect(client.setRequests).not.toContain("en|A2b");
	});

	it("stores the release date as the ISO string upstream sent, never an epoch", async () => {
		await sync();
		const jungle = setRows().find((row) => row.setKey === "en:base2");

		expect(jungle?.releaseDate).toBe("1999-06-16");
		expect(jungle?.name).toBe("Jungle");
		expect(jungle?.serieId).toBe("base");
		expect(jungle?.abbreviation).toBe("JU");
		expect(jungle?.cardCountTotal).toBe(64);
	});

	it("keeps one set per language, because the same expansion ships on different days", async () => {
		// The reason a set's identity carries its language. Collapsing these to one row would
		// order the French Jungle by the English release date and be silently wrong for it.
		await sync();
		const rows = setRows().filter((row) => row.setId === "base2");

		expect(rows.map((row) => row.setKey).sort()).toEqual(["en:base2", "fr:base2"]);
		expect(rows.find((row) => row.language === "en")?.releaseDate).toBe("1999-06-16");
		expect(rows.find((row) => row.language === "fr")?.releaseDate).toBe("2000-04-01");
	});

	it("does not ask again about a set it already has a date for", async () => {
		// The incremental half. A release date is a historical fact; re-reading it every sync
		// would spend 137 requests on somebody else's free API to learn nothing at all.
		const first = await sync();
		expect(first.setsFetched).toBe(5);
		expect(first.setsUnchanged).toBe(0);

		const second = await sync();

		// Four of the five are settled and never asked about again. The fifth is the set upstream
		// carries no date for — re-asked deliberately, in case upstream fills it in.
		expect(second.setsUnchanged).toBe(4);
		expect(second.setsFetched).toBe(1);
		expect(client.setRequests.filter((request) => request === "en|base2")).toHaveLength(1);
		expect(client.setRequests.filter((request) => request === "en|me02.5")).toHaveLength(2);
	});

	it("tolerates a set upstream carries no release date for", async () => {
		await sync();
		const undated = setRows().find((row) => row.setKey === "en:me02.5");

		expect(undated).toBeDefined();
		expect(undated?.releaseDate).toBeNull();
		expect(undated?.missingUpstream).toBe(0);
		expect(readCorpusTotals(temp.handle.db).setsWithoutReleaseDate).toBe(1);
	});

	it("flags a set that 404s rather than deleting it or dropping its cards", async () => {
		await sync();
		expect(setRows().find((row) => row.setKey === "ja:SV3")?.releaseDate).toBe("2023-07-28");

		// Upstream renames or withdraws the set. Its cards are still in the masterset.
		delete corpus.sets["ja|SV3"];
		const summary = await sync();

		expect(summary.setsFlaggedMissing).toBe(0);
		// Nothing was asked, because the date is already held — a 404 cannot reach a settled set.
		expect(client.setRequests.filter((request) => request === "ja|SV3")).toHaveLength(1);
	});

	it("flags a set that 404s the first time it is asked, and keeps a row for it", async () => {
		delete corpus.sets["ja|SV3"];
		const summary = await sync();

		expect(summary.setsFlaggedMissing).toBe(1);
		const flagged = temp.handle.db
			.select()
			.from(corpusSets)
			.where(eq(corpusSets.setKey, "ja:SV3"))
			.get();

		// A row exists even though upstream had nothing to say. Without it there would be no
		// record that the question had been asked, and no place to hang the flag.
		expect(flagged).toBeDefined();
		expect(flagged?.missingUpstream).toBe(1);
		expect(flagged?.missingSince).toBeGreaterThan(0);
		expect(flagged?.releaseDate).toBeNull();
		// And the Japanese card it belongs to is still in the corpus.
		expect(readCorpusTotals(temp.handle.db).cards).toBe(5);
	});

	it("clears the flag and keeps the row when a vanished set comes back", async () => {
		const original = corpus.sets["ja|SV3"];
		delete corpus.sets["ja|SV3"];
		await sync();
		const firstSeen = temp.handle.db
			.select()
			.from(corpusSets)
			.where(eq(corpusSets.setKey, "ja:SV3"))
			.get()?.firstSeenAt;

		if (original !== undefined) corpus.sets["ja|SV3"] = original;
		await sync();

		const restored = temp.handle.db
			.select()
			.from(corpusSets)
			.where(eq(corpusSets.setKey, "ja:SV3"))
			.get();
		expect(restored?.missingUpstream).toBe(0);
		expect(restored?.missingSince).toBeNull();
		expect(restored?.releaseDate).toBe("2023-07-28");
		expect(restored?.firstSeenAt).toBe(firstSeen);
	});

	it("leaves the row alone when the fetch fails rather than flagging it as vanished", async () => {
		// A transport failure is not a disappearance. Getting this wrong would mark half the
		// corpus's sets missing on a flaky connection.
		client.failSetFor = new Set(["en|base2"]);
		const summary = await sync();

		expect(summary.status).toBe("succeeded");
		expect(summary.setsFlaggedMissing).toBe(0);
		expect(summary.failures.some((failure) => failure.includes("en/base2"))).toBe(true);
		expect(setRows().find((row) => row.setKey === "en:base2")).toBeUndefined();

		// And the next sync picks it up, because it still has no date for it.
		client.failSetFor = new Set();
		await sync();
		expect(setRows().find((row) => row.setKey === "en:base2")?.releaseDate).toBe("1999-06-16");
	});

	it("does not chase the sets of a language whose card fetch failed", async () => {
		await sync();
		const asked = client.setRequests.length;

		client.failBriefFor = new Set(["ja"]);
		await sync();

		expect(client.setRequests.slice(asked)).not.toContain("ja|SV3");
	});

	it("records what it did on the job row, and counts sets in the corpus totals", async () => {
		const summary = await sync();

		expect(summary.setsFetched).toBe(5);
		expect(readCorpusTotals(temp.handle.db).sets).toBe(5);
	});
});
