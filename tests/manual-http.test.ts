import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { readCompletion } from "../server/copies/completion.ts";
import { insertCopy } from "../server/copies/repository.ts";
import { beginCorpusSync, runCorpusSync } from "../server/corpus/sync.ts";
import { manualCardKey, manualVariantId } from "../server/corpus/tcgdex.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { corpusCards, corpusExclusions, corpusVariants } from "../server/db/schema.ts";
import type { BinderDocument } from "../shared/contract.ts";
import { BINDER_PATH } from "../shared/contract.ts";
import { COMPLETION_PATH } from "../shared/copies.ts";
import type {
	CorpusExclusionDocument,
	CorpusExclusionListDocument,
	ManualVariantDocument,
} from "../shared/manual.ts";
import {
	CORPUS_EXCLUSIONS_PATH,
	corpusExclusionPath,
	MANUAL_VARIANTS_PATH,
	manualVariantPath,
} from "../shared/manual.ts";
import { FIRST_EDITION_VARIANT, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import { buildFakeCorpus } from "./helpers/corpus-fixture.ts";
import { FakeTcgdexClient } from "./helpers/fake-tcgdex.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * Hand-added variants and the exclusion list, through Hono against a real migrated database.
 *
 * The ticket's load-bearing claims all run here: clone-and-edit mints a reserved identity,
 * a blank create works without a source, completion counts the new row, edit and delete land,
 * the exclusion list is writable, and a shipped corpus re-import leaves both the Korean Gloom
 * and the exclusion list alone.
 */

const CARD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VARIANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECOND_VARIANT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COPY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const KOREAN_GLOOM = {
	id: CARD_ID,
	variantId: VARIANT_ID,
	language: "ko",
	setId: "base2",
	setName: "Jungle",
	localId: "44",
	name: "뚜벅쵸",
	rarity: "Uncommon",
	finish: "normal",
	size: "standard",
	stamps: ["1st edition"],
};

describe("hand-added variants", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		let clock = 1_800_000_000_000;
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => (clock += 1_000),
		});
	}

	function post(server: ReturnType<typeof app>, path: string, body: unknown) {
		return server.request(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function patch(server: ReturnType<typeof app>, path: string, body: unknown) {
		return server.request(path, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("clone-and-edit creates a new card and variant from an existing one", async () => {
		const server = app();
		const response = await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);

		expect(response.status).toBe(201);
		const created = (await response.json()) as ManualVariantDocument;
		expect(created.cardKey).toBe(manualCardKey(CARD_ID));
		expect(created.variantId).toBe(manualVariantId(VARIANT_ID));
		expect(created.language).toBe("ko");
		expect(created.name).toBe("뚜벅쵸");
		expect(created.setId).toBe("base2");
		expect(created.localId).toBe("44");
		expect(created.finish).toBe("normal");
		// Canonicalised on the way in, the same rule ingest applies to upstream spellings.
		expect(created.stamps).toEqual(["1st-edition"]);
		expect(created.provenance).toBe("manual");

		const binder = (await (await server.request(BINDER_PATH)).json()) as BinderDocument;
		const entry = binder.entries.find((row) => row.cardKey === created.cardKey);
		expect(entry).toBeDefined();
		expect(entry?.variantId).toBe(created.variantId);
		expect(entry?.provenance).toBe("manual");
		expect(entry?.name).toBe("뚜벅쵸");
	});

	it("mints a reserved identity and never inherits the source's", async () => {
		const created = (await (
			await post(app(), MANUAL_VARIANTS_PATH, KOREAN_GLOOM)
		).json()) as ManualVariantDocument;

		expect(created.cardKey).toBe("manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
		expect(created.variantId).toBe("manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
		expect(created.cardKey).not.toBe("en:base2-44");
		expect(created.variantId).not.toBe(FIRST_EDITION_VARIANT);
		expect(created.cardKey.startsWith("manual:")).toBe(true);
		expect(created.variantId.startsWith("manual:")).toBe(true);

		// Sending the source identity in the body cannot leak it into the row. The server only
		// reads the two client UUIDs and prefixes them itself.
		const sneak = await post(app(), MANUAL_VARIANTS_PATH, {
			...KOREAN_GLOOM,
			id: SECOND_CARD,
			variantId: SECOND_VARIANT,
			setId: "the-best-of-xy",
			localId: "1",
			cardKey: "en:base2-44",
			sourceVariantId: FIRST_EDITION_VARIANT,
		});
		expect(sneak.status).toBe(201);
		const sneaked = (await sneak.json()) as ManualVariantDocument;
		expect(sneaked.cardKey).toBe(manualCardKey(SECOND_CARD));
		expect(sneaked.variantId).toBe(manualVariantId(SECOND_VARIANT));
		expect(sneaked.cardKey).not.toBe("en:base2-44");
	});

	it("accepts a blank create with no relative to clone", async () => {
		const response = await post(app(), MANUAL_VARIANTS_PATH, {
			id: CARD_ID,
			variantId: VARIANT_ID,
			language: "zh-cn",
			setId: "the-best-of-xy",
			setName: "The Best of XY",
			localId: "1",
			name: "走路草",
		});
		expect(response.status).toBe(201);
		const created = (await response.json()) as ManualVariantDocument;
		expect(created.language).toBe("zh-cn");
		expect(created.setId).toBe("the-best-of-xy");
		expect(created.finish).toBeNull();
		expect(created.stamps).toEqual([]);
		expect(created.cardKey).toBe(manualCardKey(CARD_ID));
	});

	it("replays the same client UUIDs into one row", async () => {
		const server = app();
		const first = await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);
		expect(first.status).toBe(201);
		const second = await post(server, MANUAL_VARIANTS_PATH, { ...KOREAN_GLOOM, name: "other" });
		expect(second.status).toBe(200);
		const body = (await second.json()) as ManualVariantDocument;
		// First write is authoritative, the same rule as a replayed copy.
		expect(body.name).toBe("뚜벅쵸");
	});

	it("counts the hand-added row toward completion exactly like an imported one", async () => {
		const server = app();
		const before = (await (await server.request(COMPLETION_PATH)).json()) as {
			owned: number;
			total: number;
		};
		// Fixture: eight variants, one missing-upstream and unowned, so 0 / 7.
		expect(before.owned).toBe(0);
		expect(before.total).toBe(7);

		await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);

		const after = (await (await server.request(COMPLETION_PATH)).json()) as {
			owned: number;
			total: number;
		};
		expect(after.owned).toBe(0);
		expect(after.total).toBe(8);
		expect(readCompletion(temp.handle.db).total).toBe(8);
	});

	it("edits a hand-added row and refuses to edit an imported one", async () => {
		const server = app();
		await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);
		const path = manualVariantPath(manualCardKey(CARD_ID), manualVariantId(VARIANT_ID));

		const edited = await patch(server, path, { name: "이상해꽃", finish: "holo" });
		expect(edited.status).toBe(200);
		const body = (await edited.json()) as ManualVariantDocument;
		expect(body.name).toBe("이상해꽃");
		expect(body.finish).toBe("holo");
		expect(body.language).toBe("ko");

		const imported = await patch(server, manualVariantPath("en:base2-44", FIRST_EDITION_VARIANT), {
			name: "nope",
		});
		expect(imported.status).toBe(400);
		expect(((await imported.json()) as { error: string }).error).toMatch(/hand-added/);
	});

	it("deletes a hand-added row and refuses to delete an imported one", async () => {
		const server = app();
		await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);
		const path = manualVariantPath(manualCardKey(CARD_ID), manualVariantId(VARIANT_ID));

		const removed = await server.request(path, { method: "DELETE" });
		expect(removed.status).toBe(204);
		expect(readManualCard()).toBeUndefined();
		expect(readCompletion(temp.handle.db).total).toBe(7);

		const imported = await server.request(manualVariantPath("en:base2-44", FIRST_EDITION_VARIANT), {
			method: "DELETE",
		});
		expect(imported.status).toBe(400);
	});

	it("refuses to delete a hand-added row a copy still points at", async () => {
		const server = app();
		await post(server, MANUAL_VARIANTS_PATH, KOREAN_GLOOM);
		insertCopy(
			temp.handle.db,
			{ id: COPY_ID, cardKey: manualCardKey(CARD_ID), variantId: manualVariantId(VARIANT_ID) },
			1,
		);

		const removed = await server.request(
			manualVariantPath(manualCardKey(CARD_ID), manualVariantId(VARIANT_ID)),
			{ method: "DELETE" },
		);
		expect(removed.status).toBe(409);
		expect(readManualCard()?.name).toBe("뚜벅쵸");
	});

	it("refuses a language of the reserved namespace", async () => {
		const response = await post(app(), MANUAL_VARIANTS_PATH, {
			...KOREAN_GLOOM,
			language: "manual",
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toMatch(/reserved/);
	});

	it("refuses a non-UUID identifier", async () => {
		const response = await post(app(), MANUAL_VARIANTS_PATH, { ...KOREAN_GLOOM, id: "gloom-ko" });
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toMatch(/UUID/);
	});

	function readManualCard() {
		return temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.cardKey, manualCardKey(CARD_ID)))
			.get();
	}
});

describe("the exclusion list", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		let clock = 1_800_000_000_000;
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => (clock += 1_000),
		});
	}

	it("is readable, writable and deletable", async () => {
		const server = app();
		const empty = (await (
			await server.request(CORPUS_EXCLUSIONS_PATH)
		).json()) as CorpusExclusionListDocument;
		expect(empty.exclusions).toEqual([]);

		const created = await server.request(CORPUS_EXCLUSIONS_PATH, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardKey: "en:base1-45", reason: "name-sweep false positive" }),
		});
		expect(created.status).toBe(200);
		const row = (await created.json()) as CorpusExclusionDocument;
		expect(row.cardKey).toBe("en:base1-45");
		expect(row.reason).toBe("name-sweep false positive");

		const listed = (await (
			await server.request(CORPUS_EXCLUSIONS_PATH)
		).json()) as CorpusExclusionListDocument;
		expect(listed.exclusions).toHaveLength(1);

		const removed = await server.request(corpusExclusionPath("en:base1-45"), { method: "DELETE" });
		expect(removed.status).toBe(204);
		expect(temp.handle.db.select().from(corpusExclusions).all()).toHaveLength(0);
	});
});

describe("a corpus re-import against owner-authored data", () => {
	let temp: TempDatabase;
	let client: FakeTcgdexClient;
	let clock = 1_800_000_000_000;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", 1_700_000_000_000);
		client = new FakeTcgdexClient(buildFakeCorpus());
		clock = 1_800_000_000_000;
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => ++clock,
		});
	}

	async function shippedSync(): Promise<void> {
		// The ticket names this: call the shipped sync, do not reimplement it.
		const jobId = beginCorpusSync(temp.handle.db, ++clock);
		await runCorpusSync(
			{
				db: temp.handle.db,
				client,
				now: () => ++clock,
				concurrency: 2,
				pauseMs: 0,
			},
			jobId,
		);
	}

	it("touches neither a hand-added Korean Gloom nor the exclusion list", async () => {
		// The named criterion, as behaviour against the shipped sync. A Korean Gloom typed
		// through the HTTP surface, plus an exclusion written the same way, then the real
		// ingest — not a reimplementation of it — and both rows still stand.
		await shippedSync();
		const detailBeforeReimport = client.detailRequests.length;

		const server = app();
		const created = await server.request(MANUAL_VARIANTS_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(KOREAN_GLOOM),
		});
		expect(created.status).toBe(201);
		const korean = (await created.json()) as ManualVariantDocument;

		const excluded = await server.request(CORPUS_EXCLUSIONS_PATH, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardKey: "en:base1-45", reason: "not actually in the line" }),
		});
		expect(excluded.status).toBe(200);

		const before = readCompletion(temp.handle.db);
		expect(before.total).toBeGreaterThan(0);
		const koreanBefore = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.cardKey, korean.cardKey))
			.get();
		expect(koreanBefore?.name).toBe("뚜벅쵸");
		expect(koreanBefore?.lastSyncedAt).toBe(koreanBefore?.firstSeenAt);

		await shippedSync();

		const koreanAfter = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.cardKey, korean.cardKey))
			.get();
		expect(koreanAfter?.name).toBe("뚜벅쵸");
		expect(koreanAfter?.language).toBe("ko");
		expect(koreanAfter?.provenance).toBe("manual");
		expect(koreanAfter?.lastSyncedAt).toBe(koreanBefore?.lastSyncedAt);
		expect(koreanAfter?.missingUpstream).toBe(0);

		const variantAfter = temp.handle.db
			.select()
			.from(corpusVariants)
			.where(eq(corpusVariants.cardKey, korean.cardKey))
			.get();
		expect(variantAfter?.variantId).toBe(korean.variantId);
		expect(variantAfter?.provenance).toBe("manual");
		expect(variantAfter?.lastSyncedAt).toBe(koreanBefore?.lastSyncedAt);

		const exclusions = temp.handle.db.select().from(corpusExclusions).all();
		expect(exclusions).toHaveLength(1);
		expect(exclusions[0]?.cardKey).toBe("en:base1-45");
		expect(exclusions[0]?.reason).toBe("not actually in the line");

		// Applied, not just left sitting: the re-import did not fetch detail for the excluded
		// card. The row itself is still there — nothing is deleted on import — and is flagged.
		const reimportDetails = client.detailRequests.slice(detailBeforeReimport);
		expect(reimportDetails).not.toContain("en|base1-45");
		const vileplume = temp.handle.db
			.select()
			.from(corpusCards)
			.where(eq(corpusCards.cardKey, "en:base1-45"))
			.get();
		expect(vileplume?.missingUpstream).toBe(1);

		const after = readCompletion(temp.handle.db);
		// Korean still in the denominator; Vileplume now flagged missing and unowned leaves it.
		expect(after.total).toBe(before.total - 1);
	});
});
