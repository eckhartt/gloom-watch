import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_STATE_KEYS, writeAppState } from "../server/db/app-state.ts";
import { listings, seenItems } from "../server/db/schema.ts";
import { EbayClient } from "../server/ebay/client.ts";
import { PRODUCTION_API_ROOT } from "../server/ebay/credentials.ts";
import {
	everyPersistedText,
	expireListings,
	readCursor,
	rememberCategory,
	seedCursors,
	upsertObserved,
	writeCursorSuccess,
} from "../server/ebay/repository.ts";
import { marketplacesDueThisCycle, runForwardScan } from "../server/ebay/scanner.ts";
import { hashSellerUsername } from "../server/ebay/seller-hash.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import { LISTING_RETENTION_MS } from "../shared/listings.ts";
import {
	FakeEbayFetch,
	FIXTURE_SALT,
	FIXTURE_SELLER,
	fixtureSummary,
} from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const NOW = 1_800_000_000_000;

const credentials = {
	clientId: "id",
	clientSecret: "secret",
	relistHashSalt: FIXTURE_SALT,
	apiRoot: PRODUCTION_API_ROOT,
};

describe("which marketplaces run in a cycle", () => {
	it("scans only AU", () => {
		expect(marketplacesDueThisCycle(1)).toEqual(["AU"]);
		expect(marketplacesDueThisCycle(4)).toEqual(["AU"]);
	});
});

describe("the forward scanner", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	function client(fake: FakeEbayFetch): EbayClient {
		return new EbayClient(credentials, fake.fetch, fake.sleep);
	}

	async function scan(fake: FakeEbayFetch, now = NOW, budget?: number) {
		return runForwardScan({
			db: temp.handle.db,
			client: client(fake),
			now: () => now,
			keywords: ["Gloom"],
			...(budget === undefined ? {} : { dailyBudget: budget }),
		});
	}

	it("stores the whitelist and no persisted column holds the seller username", async () => {
		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|seller-ban|0" })]);

		await scan(fake);

		const values = everyPersistedText(temp.handle.sqlite);
		expect(values.some((value) => value.includes(FIXTURE_SELLER))).toBe(false);

		const row = temp.handle.db.select().from(listings).all();
		expect(row).toHaveLength(1);
		expect(row[0]?.sellerHash).toBe(hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT));
		expect(row[0]?.conditionId).toBe(4000);
		expect(row[0]?.title).toBe("Gloom Jungle 44/64");
	});

	it("records every item id in the seen-set", async () => {
		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([
			fixtureSummary({ itemId: "v1|a|0" }),
			fixtureSummary({ itemId: "v1|b|0" }),
		]);

		await scan(fake);

		const seen = temp.handle.db.select().from(seenItems).all();
		expect(seen.map((row) => row.itemId).sort()).toEqual(["v1|a|0", "v1|b|0"]);
	});

	it("does not advance US, GB or DE when only AU runs", async () => {
		seedCursors(temp.handle.db, NOW);
		writeCursorSuccess(temp.handle.db, "US", 1_000, NOW, "183454");
		writeCursorSuccess(temp.handle.db, "GB", 2_000, NOW, "183455");

		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|au|0" })]);

		const result = await scan(fake);
		expect(result.cycle).toBe(1);
		expect(
			result.marketplaces.filter((entry) => entry.ran).map((entry) => entry.marketplace),
		).toEqual(["AU"]);

		expect(readCursor(temp.handle.db, "US")?.lastScannedAt).toBe(1_000);
		expect(readCursor(temp.handle.db, "GB")?.lastScannedAt).toBe(2_000);
		expect(readCursor(temp.handle.db, "AU")?.lastScannedAt).toBe(NOW);
	});

	it("leaves a failed marketplace cursor and increments its failure count", async () => {
		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|ok|0" })]);
		fake.failMarketplaces.add("EBAY_AU");

		const result = await scan(fake);
		const au = result.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(au?.complete).toBe(false);
		expect(au?.error).toMatch(/500/);
		expect(readCursor(temp.handle.db, "AU")?.lastScannedAt).toBeNull();
		expect(readCursor(temp.handle.db, "AU")?.consecutiveFailures).toBe(1);
	});

	it("pages through to exhaustion", async () => {
		const fake = new FakeEbayFetch();
		fake.pageTwice(
			[fixtureSummary({ itemId: "v1|page-1|0" })],
			[fixtureSummary({ itemId: "v1|page-2|0" })],
		);

		await scan(fake);

		const ids = temp.handle.db
			.select()
			.from(listings)
			.all()
			.map((row) => row.itemId)
			.sort();
		expect(ids).toEqual(["v1|page-1|0", "v1|page-2|0"]);
	});

	it("stops when the daily call budget is spent and does not advance the cursor", async () => {
		seedCursors(temp.handle.db, NOW);
		rememberCategory(temp.handle.db, "AU", "183454", NOW);
		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|budget|0" })]);

		const result = await scan(fake, NOW, 1);
		const au = result.marketplaces.find((entry) => entry.marketplace === "AU");
		expect(au?.complete).toBe(false);
		expect(readCursor(temp.handle.db, "AU")?.lastScannedAt).toBeNull();
		expect(fake.requests.filter((request) => request.url.includes("item_summary")).length).toBe(1);
	});

	it("backs off on 429 and then continues", async () => {
		const fake = new FakeEbayFetch();
		fake.tooManyTimes = 1;
		fake.retryAfterSeconds = 2;
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|429|0" })]);

		await scan(fake, NOW, 20);

		expect(fake.sleeps).toContain(2_000);
		expect(temp.handle.db.select().from(listings).all()).toHaveLength(1);
	});

	it("expires listing rows at 90 days and leaves the seen-set alone", () => {
		const observed = whitelistItem(fixtureSummary({ itemId: "v1|old|0" }), FIXTURE_SALT);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "US", NOW - LISTING_RETENTION_MS - 1);

		expect(expireListings(temp.handle.db, NOW)).toBe(1);
		expect(temp.handle.db.select().from(listings).all()).toEqual([]);
		expect(temp.handle.db.select().from(seenItems).all()).toHaveLength(1);
		expect(temp.handle.db.select().from(seenItems).all()[0]?.itemId).toBe("v1|old|0");
	});

	it("does not purge the seen-set when a later cycle expires the listing", async () => {
		const observed = whitelistItem(fixtureSummary({ itemId: "v1|keep-seen|0" }), FIXTURE_SALT);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "US", NOW - LISTING_RETENTION_MS - 1);

		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([]);
		await scan(fake);

		expect(temp.handle.db.select().from(listings).all()).toEqual([]);
		expect(temp.handle.db.select().from(seenItems).all()).toHaveLength(1);
	});

	it("starts a later cycle at the next number and still only runs AU", async () => {
		writeAppState(temp.handle.db, APP_STATE_KEYS.scanCycleCount, "3", NOW);
		const fake = new FakeEbayFetch();
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|c4|0" })]);

		const result = await scan(fake);
		expect(result.cycle).toBe(4);
		expect(
			result.marketplaces.filter((entry) => entry.ran).map((entry) => entry.marketplace),
		).toEqual(["AU"]);
	});
});
