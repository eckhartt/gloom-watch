import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listings, pushEchoLog, seenItems } from "../server/db/schema.ts";
import { runBackfill } from "../server/ebay/backfill.ts";
import { EbayClient } from "../server/ebay/client.ts";
import { PRODUCTION_API_ROOT } from "../server/ebay/credentials.ts";
import {
	everyPersistedText,
	isBackfillComplete,
	readBackfill,
	readCursor,
	readScanHealth,
	rememberCategory,
	seedCursors,
	writeCursorSuccess,
} from "../server/ebay/repository.ts";
import { runForwardScan } from "../server/ebay/scanner.ts";
import * as pushSend from "../server/push/send.ts";
import { DAY_MS, DEEP_PAGE_CAP } from "../shared/listings.ts";
import {
	FakeEbayFetch,
	FIXTURE_SALT,
	FIXTURE_SELLER,
	fixtureSummary,
	parseItemStartDateRange,
} from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const NOW = 1_800_000_000_000;

const credentials = {
	clientId: "id",
	clientSecret: "secret",
	relistHashSalt: FIXTURE_SALT,
	apiRoot: PRODUCTION_API_ROOT,
};

describe("inventory backfill and the forward-cursor gate", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedCursors(temp.handle.db, NOW);
		rememberCategory(temp.handle.db, "AU", "183454", NOW);
	});

	afterEach(() => {
		temp.dispose();
	});

	function client(fake: FakeEbayFetch): EbayClient {
		return new EbayClient(credentials, fake.fetch, fake.sleep);
	}

	function backfill(
		fake: FakeEbayFetch,
		options: {
			readonly now?: number;
			readonly horizonDays?: number;
			readonly windowDays?: number;
			readonly budget?: number;
		} = {},
	) {
		return runBackfill({
			db: temp.handle.db,
			client: client(fake),
			now: () => options.now ?? NOW,
			keywords: ["Gloom"],
			horizonDays: options.horizonDays ?? 14,
			windowDays: options.windowDays ?? 7,
			...(options.budget === undefined ? {} : { dailyBudget: options.budget }),
		});
	}

	function forward(fake: FakeEbayFetch, now = NOW, budget?: number) {
		return runForwardScan({
			db: temp.handle.db,
			client: client(fake),
			now: () => now,
			keywords: ["Gloom"],
			...(budget === undefined ? {} : { dailyBudget: budget }),
		});
	}

	function searchRequests(fake: FakeEbayFetch): string[] {
		return fake.requests
			.filter((request) => request.url.includes("item_summary"))
			.map((r) => r.url);
	}

	it("does not run a marketplace's forward cursor until its backfill is complete", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|old|0",
				itemOriginDate: new Date(NOW - 3 * DAY_MS).toISOString(),
			}),
		]);

		const skipped = await forward(fake);
		const au = skipped.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(au?.ran).toBe(false);
		expect(au?.skipped).toBe("backfill-incomplete");
		expect(isBackfillComplete(temp.handle.db, "AU")).toBe(false);
		expect(searchRequests(fake)).toEqual([]);
		expect(temp.handle.db.select().from(listings).all()).toEqual([]);
	});

	it("runs the forward cursor once that marketplace's backfill is complete", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|old|0",
				itemOriginDate: new Date(NOW - 3 * DAY_MS).toISOString(),
			}),
		]);

		const swept = await backfill(fake);
		expect(swept.marketplaces.find((entry) => entry.marketplace === "AU")?.complete).toBe(true);
		expect(isBackfillComplete(temp.handle.db, "AU")).toBe(true);

		const after = await forward(fake);
		const au = after.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(au?.ran).toBe(true);
		expect(au?.skipped).toBeUndefined();
		expect(searchRequests(fake).length).toBeGreaterThan(0);
	});

	it("resumes a mid-sweep from the persisted window rather than restarting", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|recent|0",
				itemOriginDate: new Date(NOW - 1 * DAY_MS).toISOString(),
			}),
			fixtureSummary({
				itemId: "v1|older|0",
				itemOriginDate: new Date(NOW - 10 * DAY_MS).toISOString(),
			}),
		]);

		const first = await backfill(fake, { budget: 2 });
		const auFirst = first.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(auFirst?.complete).toBe(false);
		expect(isBackfillComplete(temp.handle.db, "AU")).toBe(false);

		const paused = readBackfill(temp.handle.db, "AU");
		expect(paused?.startedAt).toBe(NOW);
		expect(paused?.horizonAt).toBe(NOW - 14 * DAY_MS);
		expect(paused?.windowEnd).toBe(NOW - 7 * DAY_MS);
		expect(paused?.completeAt).toBeNull();

		const firstSeen = searchRequests(fake).length;

		const second = await backfill(fake, { budget: 20 });
		expect(second.marketplaces.find((entry) => entry.marketplace === "AU")?.complete).toBe(true);
		expect(isBackfillComplete(temp.handle.db, "AU")).toBe(true);
		expect(readBackfill(temp.handle.db, "AU")?.startedAt).toBe(NOW);
		expect(readBackfill(temp.handle.db, "AU")?.horizonAt).toBe(NOW - 14 * DAY_MS);

		const ids = temp.handle.db
			.select()
			.from(listings)
			.all()
			.map((row) => row.itemId)
			.sort();
		expect(ids).toEqual(["v1|older|0", "v1|recent|0"]);
		expect(searchRequests(fake).length).toBeGreaterThan(firstSeen);
	});

	it("seeds the seen-set and a second pass does not insert the same item as new", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|seed|0",
				itemOriginDate: new Date(NOW - 2 * DAY_MS).toISOString(),
			}),
		]);

		await backfill(fake);
		const seen = temp.handle.db.select().from(seenItems).all();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.itemId).toBe("v1|seed|0");
		const firstSeenAt = seen[0]?.firstSeenAt;

		await backfill(fake);
		expect(temp.handle.db.select().from(listings).all()).toHaveLength(1);
		expect(temp.handle.db.select().from(seenItems).all()).toHaveLength(1);
		expect(temp.handle.db.select().from(seenItems).all()[0]?.firstSeenAt).toBe(firstSeenAt);
	});

	it("sends no notification and leaves the push echo log empty", async () => {
		const notify = vi.spyOn(pushSend, "sendPushToEverySubscription");
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|quiet|0",
				itemOriginDate: new Date(NOW - 2 * DAY_MS).toISOString(),
			}),
		]);

		await backfill(fake);
		await forward(fake);

		expect(notify).not.toHaveBeenCalled();
		expect(temp.handle.db.select().from(pushEchoLog).all()).toEqual([]);
		notify.mockRestore();
	});

	it("finds an origin-date that predates the forward window, and the forward scan does not", async () => {
		const fake = new FakeEbayFetch();
		const origin = NOW - 3 * DAY_MS;
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|pre-cursor|0",
				itemOriginDate: new Date(origin).toISOString(),
			}),
		]);

		await backfill(fake, { horizonDays: 7, windowDays: 7 });
		expect(
			temp.handle.db
				.select()
				.from(listings)
				.all()
				.map((row) => row.itemId),
		).toEqual(["v1|pre-cursor|0"]);
		expect(
			temp.handle.db
				.select()
				.from(seenItems)
				.all()
				.map((row) => row.itemId),
		).toEqual(["v1|pre-cursor|0"]);

		const beforeForward = searchRequests(fake).length;
		await forward(fake);
		const forwardUrls = searchRequests(fake).slice(beforeForward);
		expect(forwardUrls.length).toBeGreaterThan(0);
		for (const url of forwardUrls) {
			const range = parseItemStartDateRange(url);
			expect(range).not.toBeNull();
			if (range === null) continue;
			expect(origin < range.from || (range.to !== null && origin > range.to)).toBe(true);
		}
		expect(temp.handle.db.select().from(listings).all()).toHaveLength(1);
	});

	it("honours the configured horizon and leaves older stock unseen", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|in-horizon|0",
				itemOriginDate: new Date(NOW - 3 * DAY_MS).toISOString(),
			}),
			fixtureSummary({
				itemId: "v1|before-horizon|0",
				itemOriginDate: new Date(NOW - 20 * DAY_MS).toISOString(),
			}),
		]);

		await backfill(fake, { horizonDays: 7, windowDays: 7 });
		const ids = temp.handle.db
			.select()
			.from(listings)
			.all()
			.map((row) => row.itemId);
		expect(ids).toEqual(["v1|in-horizon|0"]);
		expect(readBackfill(temp.handle.db, "AU")?.horizonAt).toBe(NOW - 7 * DAY_MS);
	});

	it("narrows a window whose result count approaches the paging cap", async () => {
		const fake = new FakeEbayFetch();
		fake.onSearch(
			(url) => url.pathname.endsWith("/item_summary/search"),
			(url) => {
				const range = parseItemStartDateRange(url.toString());
				const span = range === null ? 0 : (range.to ?? NOW) - range.from;
				if (span > 4 * DAY_MS) {
					return new Response(JSON.stringify({ itemSummaries: [], total: DEEP_PAGE_CAP }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(
					JSON.stringify({
						itemSummaries: [
							fixtureSummary({
								itemId: "v1|narrowed|0",
								itemOriginDate: new Date(NOW - 1 * DAY_MS).toISOString(),
							}),
						],
						total: 1,
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);

		const result = await backfill(fake, { horizonDays: 7, windowDays: 7 });
		expect(result.marketplaces.find((entry) => entry.marketplace === "AU")?.complete).toBe(true);

		const spans = searchRequests(fake)
			.map((url) => parseItemStartDateRange(url))
			.filter((range): range is NonNullable<typeof range> => range !== null)
			.map((range) => (range.to ?? NOW) - range.from);
		expect(spans.some((span) => span < 7 * DAY_MS)).toBe(true);
		expect(spans.some((span) => span <= 4 * DAY_MS)).toBe(true);
		expect(
			temp.handle.db
				.select()
				.from(listings)
				.all()
				.map((row) => row.itemId),
		).toEqual(["v1|narrowed|0"]);
	});

	it("surfaces progress on the health document while a sweep is mid-window", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|progress|0",
				itemOriginDate: new Date(NOW - 1 * DAY_MS).toISOString(),
			}),
		]);

		await backfill(fake, { budget: 2 });
		const health = readScanHealth(temp.handle.db, NOW);
		const au = health.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(au?.backfillCompleteAt).toBeNull();
		expect(au?.backfillStartedAt).toBe(NOW);
		expect(au?.backfillHorizonAt).toBe(NOW - 14 * DAY_MS);
		expect(au?.backfillWindowEnd).toBe(NOW - 7 * DAY_MS);
		expect(au?.backfillItemsUpserted).toBeGreaterThan(0);
	});

	it("does not persist a seller username and does not backfill disabled marketplaces", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([
			fixtureSummary({
				itemId: "v1|au-only|0",
				itemOriginDate: new Date(NOW - 1 * DAY_MS).toISOString(),
			}),
		]);

		const result = await backfill(fake);
		expect(result.marketplaces.find((entry) => entry.marketplace === "US")?.ran).toBe(false);
		expect(isBackfillComplete(temp.handle.db, "US")).toBe(false);
		expect(fake.requests.some((request) => request.marketplace === "EBAY_US")).toBe(false);

		const values = everyPersistedText(temp.handle.sqlite);
		expect(values.some((value) => value.includes(FIXTURE_SELLER))).toBe(false);
	});

	it("does not rewind an existing forward cursor when the sweep finishes", async () => {
		const fake = new FakeEbayFetch();
		fake.setInventory([]);
		const existing = NOW - 60_000;
		writeCursorSuccess(temp.handle.db, "AU", existing, NOW, "183454");

		await backfill(fake, { horizonDays: 7, windowDays: 7 });
		expect(isBackfillComplete(temp.handle.db, "AU")).toBe(true);
		expect(readCursor(temp.handle.db, "AU")?.lastScannedAt).toBe(existing);
	});
});
