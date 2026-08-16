import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readCorpusTotals,
	readLastSuccessfulSyncAt,
	readSyncJob,
	reconcileInterruptedJobs,
} from "../server/corpus/repository.ts";
import { beginCorpusSync, type CorpusSyncSummary, runCorpusSync } from "../server/corpus/sync.ts";
import { corpusCards, corpusExclusions, corpusVariants } from "../server/db/schema.ts";
import { buildFakeCorpus, SHARED_VARIANT_ID } from "./helpers/corpus-fixture.ts";
import { type FakeCorpus, FakeTcgdexClient } from "./helpers/fake-tcgdex.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The sync driven end to end against a real migrated SQLite database with TCGdex faked at its
 * HTTP boundary. Re-import safety is tested as behaviour against that database, per the spec.
 */
describe("a corpus sync", () => {
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
			{
				db: temp.handle.db,
				client,
				now: () => clock++,
				concurrency: 2,
				pauseMs: 0,
			},
			jobId,
		);
	}

	function cardRows() {
		return temp.handle.db.select().from(corpusCards).all();
	}

	function variantRows() {
		return temp.handle.db.select().from(corpusVariants).all();
	}

	it("ingests every language upstream carries, without a hard-coded list", async () => {
		const summary = await sync();
		expect(summary.status).toBe("succeeded");
		// Four languages derived; `nl` carries no Oddish-line card and so contributes no rows.
		expect(summary.languagesDerived).toEqual(["en", "fr", "ja", "nl"]);
		expect([...new Set(cardRows().map((c) => c.language))].sort()).toEqual(["en", "fr", "ja"]);
	});

	it("makes language part of card identity", async () => {
		await sync();
		const keys = cardRows().map((c) => c.cardKey);
		expect(keys).toContain("en:base2-44");
		expect(keys).toContain("fr:base2-44");
		const en = cardRows().find((c) => c.cardKey === "en:base2-44");
		const fr = cardRows().find((c) => c.cardKey === "fr:base2-44");
		expect(en?.name).toBe("Gloom");
		expect(fr?.name).toBe("Ortide");
		expect(en?.setId).toBe(fr?.setId);
		expect(en?.localId).toBe(fr?.localId);
	});

	it("keys variants on (card, variant_id), so one shared id yields three rows", async () => {
		await sync();
		const shared = variantRows().filter((v) => v.variantId === SHARED_VARIANT_ID);
		expect(shared.map((v) => v.cardKey).sort()).toEqual([
			"en:base1-45",
			"en:base2-44",
			"fr:base2-44",
		]);
	});

	it("stores `generated` as an opaque token on more than one card", async () => {
		await sync();
		const generated = variantRows().filter((v) => v.variantId === "generated");
		expect(generated.map((v) => v.cardKey).sort()).toEqual(["en:me02.5-002", "ja:SV3-002"]);
	});

	it("canonicalises the axes across languages", async () => {
		await sync();
		// The French Jungle Gloom carries `Olografica`, `1re Édition`, `Poké Ball` and `Standard`.
		const fr = variantRows().find((v) => v.cardKey === "fr:base2-44");
		expect(fr?.finish).toBe("holo");
		expect(fr?.foil).toBe("pokeball");
		expect(fr?.size).toBe("standard");
		expect(JSON.parse(fr?.stamps ?? "[]")).toEqual(["1st-edition"]);

		// `1st edition` (Japanese) and `1st-edition` (English) land on the same stored value.
		const ja = variantRows().find((v) => v.cardKey === "ja:SV3-002");
		const en = variantRows().find((v) => v.variantId === "2fnyg4g532wu2uft0spaa3eefrz");
		expect(ja?.stamps).toBe(en?.stamps);
		expect(JSON.parse(ja?.stamps ?? "[]")).toEqual(["1st-edition"]);
	});

	it("excludes TCG Pocket by prefix and never fetches its detail", async () => {
		await sync();
		expect(cardRows().map((c) => c.cardKey)).not.toContain("en:A2b-002");
		expect(client.detailRequests).not.toContain("en|A2b-002");
	});

	it("fetches detail only for members, which is what the local filter buys", async () => {
		await sync();
		expect(client.detailRequests.sort()).toEqual([
			"en|base1-45",
			"en|base2-44",
			"en|me02.5-002",
			"fr|base2-44",
			"ja|SV3-002",
		]);
		// Charizard is in the brief snapshot and was never asked about.
		expect(client.detailRequests).not.toContain("en|base1-4");
	});

	it("admits a name-only hit and a dex-only hit, recording which half admitted it", async () => {
		await sync();
		const byKey = new Map(cardRows().map((c) => [c.cardKey, c.membershipReason]));
		expect(byKey.get("en:me02.5-002")).toBe("name");
		expect(byKey.get("ja:SV3-002")).toBe("dex");
		expect(byKey.get("en:base2-44")).toBe("both");
	});

	it("records provenance and a last-synced timestamp on every row", async () => {
		await sync();
		for (const card of cardRows()) {
			expect(card.provenance).toBe("tcgdex");
			expect(card.lastSyncedAt).toBeGreaterThan(0);
			expect(card.firstSeenAt).toBeGreaterThan(0);
		}
		for (const variant of variantRows()) {
			expect(variant.provenance).toBe("tcgdex");
			expect(variant.lastSyncedAt).toBeGreaterThan(0);
		}
	});

	it("stores one webp BLOB per card record", async () => {
		const summary = await sync();
		const withImages = cardRows().filter((c) => c.imageBytes !== null);
		expect(withImages).toHaveLength(4);
		expect(summary.imagesFetched).toBe(4);
		for (const card of withImages) {
			expect(card.imageContentType).toBe("image/webp");
			expect(card.imageByteSize).toBe(16);
			// A real RIFF/WEBP header, so this is bytes and not a stringified something.
			expect(
				Buffer.from(card.imageBytes as Buffer)
					.subarray(0, 4)
					.toString(),
			).toBe("RIFF");
			expect(card.imageHash).toMatch(/^hash-/);
		}
		// The card upstream has no image for is stored, imageless, rather than dropped.
		const imageless = cardRows().find((c) => c.cardKey === "en:me02.5-002");
		expect(imageless).toBeDefined();
		expect(imageless?.imageBytes).toBeNull();
	});

	it("builds each image URL case-correctly in every segment", async () => {
		await sync();
		expect(client.imageRequests.sort()).toEqual([
			"https://assets.tcgdex.net/en/base/base1/45/high.webp",
			"https://assets.tcgdex.net/en/base/base2/44/high.webp",
			"https://assets.tcgdex.net/fr/base/base2/44/high.webp",
			// Japanese set IDs are naturally uppercase and must stay that way.
			"https://assets.tcgdex.net/ja/sv/SV3/002/high.webp",
		]);
	});

	it("re-fetches an image only when the manifest hash moves", async () => {
		await sync();
		const first = client.imageRequests.length;
		expect(first).toBe(4);

		// Second sync: same manifest ETag, so a 304 and nothing to fetch.
		const second = await sync();
		expect(client.imageRequests).toHaveLength(first);
		expect(second.imagesFetched).toBe(0);
		expect(second.imagesUnchanged).toBe(4);

		// Upstream republishes one card's art.
		corpus.manifestEtag = '"manifest-v2"';
		const enBase = corpus.manifest.en?.base;
		if (enBase?.base2 !== undefined) enBase.base2["44"] = "hash-en-base2-44-v2";
		const third = await sync();
		expect(third.imagesFetched).toBe(1);
		expect(client.imageRequests.at(-1)).toBe(
			"https://assets.tcgdex.net/en/base/base2/44/high.webp",
		);
	});
});

describe("re-import safety", () => {
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

	it("flags a vanished variant rather than deleting it, and keeps the row", async () => {
		await sync();
		const before = readCorpusTotals(temp.handle.db).variants;

		// Upstream drops the 1st Edition printing of the English Jungle Gloom.
		const detail = corpus.details["en|base2-44"];
		if (detail !== undefined) {
			corpus.details["en|base2-44"] = {
				...detail,
				variants_detailed: [{ type: "normal", size: "standard", variantId: SHARED_VARIANT_ID }],
			};
		}

		const summary = await sync();
		expect(summary.variantsFlaggedMissing).toBe(1);

		// The count did not go down. That is the whole point: a silent deletion shrinks the
		// completion denominator and makes the percentage go *up* with every test still green.
		expect(readCorpusTotals(temp.handle.db).variants).toBe(before);
		const flagged = temp.handle.db
			.select()
			.from(corpusVariants)
			.where(eq(corpusVariants.variantId, "2fnyg4g532wu2uft0spaa3eefrz"))
			.get();
		expect(flagged?.missingUpstream).toBe(1);
		expect(flagged?.missingSince).toBeGreaterThan(0);
	});

	it("clears the flag and keeps the identity when a variant comes back", async () => {
		await sync();
		const original = corpus.details["en|base2-44"];
		if (original !== undefined) {
			corpus.details["en|base2-44"] = {
				...original,
				variants_detailed: [{ type: "normal", size: "standard", variantId: SHARED_VARIANT_ID }],
			};
		}
		await sync();
		const firstSeen = temp.handle.db
			.select()
			.from(corpusVariants)
			.where(eq(corpusVariants.variantId, "2fnyg4g532wu2uft0spaa3eefrz"))
			.get()?.firstSeenAt;

		if (original !== undefined) corpus.details["en|base2-44"] = original;
		await sync();

		const restored = temp.handle.db
			.select()
			.from(corpusVariants)
			.where(eq(corpusVariants.variantId, "2fnyg4g532wu2uft0spaa3eefrz"))
			.get();
		expect(restored?.missingUpstream).toBe(0);
		expect(restored?.missingSince).toBeNull();
		// Not renumbered: the row is the same row, with the same first-seen stamp a copy would
		// have been attached to.
		expect(restored?.firstSeenAt).toBe(firstSeen);
	});

	it("never touches a hand-added row", async () => {
		// A Korean printing typed by hand, in the reserved namespace, plus a manual variant added
		// onto a card the sync does own.
		temp.handle.db
			.insert(corpusCards)
			.values({
				cardKey: "manual:11111111-1111-4111-8111-111111111111",
				language: "ko",
				cardId: "11111111-1111-4111-8111-111111111111",
				setId: "the-best-of-xy",
				localId: "1",
				name: "뚜벅쵸",
				membershipReason: "name",
				provenance: "manual",
				firstSeenAt: 1,
				lastSyncedAt: 1,
			})
			.run();
		temp.handle.db
			.insert(corpusVariants)
			.values({
				cardKey: "manual:11111111-1111-4111-8111-111111111111",
				variantId: "manual-holo",
				finish: "holo",
				stamps: "[]",
				provenance: "manual",
				firstSeenAt: 1,
				lastSyncedAt: 1,
			})
			.run();

		const summary = await sync();

		const manual = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.provenance, "manual"))
			.get();
		expect(manual?.name).toBe("뚜벅쵸");
		expect(manual?.lastSyncedAt).toBe(1);
		// `ko` was never in the language list, so the row is not flagged missing either.
		expect(manual?.missingUpstream).toBe(0);
		expect(summary.cardsFlaggedMissing).toBe(0);

		const manualVariant = temp.handle.db
			.select()
			.from(corpusVariants)
			.where(eq(corpusVariants.provenance, "manual"))
			.get();
		expect(manualVariant?.lastSyncedAt).toBe(1);
	});

	it("leaves the exclusions table alone and honours it", async () => {
		temp.handle.db
			.insert(corpusExclusions)
			.values({ cardKey: "en:base1-45", reason: "not actually mine to collect", createdAt: 5 })
			.run();

		await sync();

		expect(temp.handle.db.select().from(corpusExclusions).all()).toHaveLength(1);
		expect(cardRowKeys()).not.toContain("en:base1-45");
		expect(client.detailRequests).not.toContain("en|base1-45");
	});

	function cardRowKeys(): string[] {
		return temp.handle.db
			.select()
			.from(corpusCards)
			.all()
			.map((c) => c.cardKey);
	}

	it("does not flag a whole language as vanished when its fetch failed", async () => {
		await sync();
		const before = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.language, "ja"))
			.all();
		expect(before).toHaveLength(1);

		client.failBriefFor = new Set(["ja"]);
		const summary = await sync();

		// The Japanese card is untouched, not marked as having disappeared from upstream.
		const after = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.language, "ja"))
			.get();
		expect(after?.missingUpstream).toBe(0);
		expect(summary.languagesSynced).not.toContain("ja");
		expect(summary.failures.some((f) => f.includes("ja"))).toBe(true);
		expect(summary.status).toBe("succeeded");
	});
});

describe("the sync job record", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	it("is observable while it runs and carries the counts when it finishes", async () => {
		const corpus = buildFakeCorpus();
		const client = new FakeTcgdexClient(corpus);
		let clock = 1_800_000_000_000;
		const jobId = beginCorpusSync(temp.handle.db, clock);

		// Visible before any work happens — this is what makes the button non-blocking.
		const created = readSyncJob(temp.handle.db, jobId);
		expect(created?.status).toBe("running");
		expect(created?.phase).toBe("languages");

		await runCorpusSync(
			{ db: temp.handle.db, client, now: () => clock++, concurrency: 2, pauseMs: 0 },
			jobId,
		);

		const finished = readSyncJob(temp.handle.db, jobId);
		expect(finished?.status).toBe("succeeded");
		expect(finished?.phase).toBe("done");
		expect(finished?.finishedAt).not.toBeNull();
		expect(finished?.cardsUpserted).toBe(5);
		expect(finished?.variantsUpserted).toBe(6);
		expect(finished?.imagesFetched).toBe(4);
		expect(finished?.variantCountBefore).toBe(0);
		expect(finished?.variantCountAfter).toBe(6);
		expect(JSON.parse(finished?.languagesSynced ?? "[]")).toEqual(["en", "fr", "ja", "nl"]);
		expect(readLastSuccessfulSyncAt(temp.handle.db)).toBe(finished?.finishedAt);
	});

	it("survives a restart as `interrupted` rather than claiming to still be running", async () => {
		const jobId = beginCorpusSync(temp.handle.db, 1000);
		expect(readSyncJob(temp.handle.db, jobId)?.status).toBe("running");

		// What `server/index.ts` does at boot.
		expect(reconcileInterruptedJobs(temp.handle.db, 2000)).toBe(1);

		const row = readSyncJob(temp.handle.db, jobId);
		expect(row?.status).toBe("interrupted");
		expect(row?.finishedAt).toBe(2000);
		expect(row?.error).toContain("restart");
		// An interrupted job is not a successful sync, so "last synced" stays null.
		expect(readLastSuccessfulSyncAt(temp.handle.db)).toBeNull();
	});

	it("records a failure on the row rather than throwing at the caller", async () => {
		const corpus = buildFakeCorpus();
		const client = new FakeTcgdexClient(corpus);
		client.failBriefFor = new Set(["en", "fr", "ja", "nl"]);
		let clock = 1_800_000_000_000;
		const jobId = beginCorpusSync(temp.handle.db, clock);

		const summary = await runCorpusSync(
			{ db: temp.handle.db, client, now: () => clock++, pauseMs: 0 },
			jobId,
		);

		expect(summary.status).toBe("failed");
		const row = readSyncJob(temp.handle.db, jobId);
		expect(row?.status).toBe("failed");
		expect(row?.error).toContain("no language could be fetched");
	});
});
