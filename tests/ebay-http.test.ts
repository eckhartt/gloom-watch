import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { upsertObserved } from "../server/ebay/repository.ts";
import { hashSellerUsername } from "../server/ebay/seller-hash.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import type { ListingDocument, ListingsDocument } from "../shared/listings.ts";
import { DISPLAY_FRESHNESS_MS, LISTINGS_PATH, listingPath } from "../shared/listings.ts";
import { FIXTURE_SALT, FIXTURE_SELLER, fixtureSummary } from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const NOW = 1_800_000_000_000;

describe("the listings feed", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", NOW);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app(now = NOW) {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => now,
		});
	}

	function persist(itemId: string, observedAt: number): void {
		const observed = whitelistItem(fixtureSummary({ itemId }), FIXTURE_SALT);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "US", observedAt);
	}

	it("shows a fresh listing with its price, seen-at and outbound link", async () => {
		persist("v1|fresh|0", NOW - 10 * 60_000);

		const response = await app().request(LISTINGS_PATH);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");

		const body = (await response.json()) as ListingsDocument;
		expect(body.listings).toHaveLength(1);
		const listing = body.listings[0] as ListingDocument;
		expect(listing.itemId).toBe("v1|fresh|0");
		expect(listing.priceMinor).toBe(1299);
		expect(listing.currency).toBe("USD");
		expect(listing.priceHidden).toBe(false);
		expect(listing.itemWebUrl).toContain("ebay.com");
		expect(listing.observedAt).toBe(NOW - 10 * 60_000);
		expect(listing.ageDisclosed).toBe("10 minutes old");
		expect(JSON.stringify(listing)).not.toContain(FIXTURE_SELLER);
		expect(JSON.stringify(listing)).not.toContain("sellerHash");
		expect(JSON.stringify(listing)).not.toContain(hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT));
		expect(JSON.stringify(listing)).not.toContain("Very Good");
	});

	it("hides the price past six hours and discloses the age", async () => {
		persist("v1|stale|0", NOW - DISPLAY_FRESHNESS_MS - 1);

		const body = (await (await app().request(LISTINGS_PATH)).json()) as ListingsDocument;
		const listing = body.listings[0] as ListingDocument;
		expect(listing.priceHidden).toBe(true);
		expect(listing.priceMinor).toBeNull();
		expect(listing.currency).toBeNull();
		expect(listing.ageDisclosed).toBe("6 hours old");
		expect(listing.observedAt).toBe(NOW - DISPLAY_FRESHNESS_MS - 1);
	});

	it("resolves one listing on a cold load", async () => {
		persist("v1|detail|0", NOW);

		const response = await app().request(listingPath("v1|detail|0"));
		expect(response.status).toBe(200);
		const listing = (await response.json()) as ListingDocument;
		expect(listing.itemId).toBe("v1|detail|0");
	});

	it("answers 404 for an item the scanner has never stored", async () => {
		const response = await app().request(listingPath("v1|missing|0"));
		expect(response.status).toBe(404);
	});

	it("puts per-marketplace scan health on the health document", async () => {
		const body = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(body.scan.cycle).toBe(0);
		expect(body.scan.marketplaces.map((entry) => entry.marketplace)).toEqual([
			"US",
			"GB",
			"DE",
			"AU",
		]);
	});
});
