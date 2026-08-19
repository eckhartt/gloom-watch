import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { insertCopy } from "../server/copies/repository.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { copies } from "../server/db/schema.ts";
import { upsertObserved } from "../server/ebay/repository.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import type { ListingDocument, ListingsDocument } from "../shared/listings.ts";
import { LISTINGS_PATH } from "../shared/listings.ts";
import { describeResolution } from "../shared/matcher.ts";
import { FIRST_EDITION_VARIANT, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import { FIXTURE_SALT, fixtureSummary } from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const NOW = 1_800_000_000_000;

describe("the feed shows what a listing resolved to", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", NOW);
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => NOW,
		});
	}

	function persist(
		itemId: string,
		title: string,
		aspects: { name: string; value: string }[] = [],
	): void {
		const observed = whitelistItem(
			fixtureSummary({
				itemId,
				title,
				itemLocation: { country: "AU" },
				localizedAspects: aspects,
			}),
			FIXTURE_SALT,
		);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "AU", NOW);
	}

	it("puts grain, candidates and matcher version on the listing document", async () => {
		persist("v1|jungle|0", "Gloom Jungle 44/64");

		const body = (await (await app().request(LISTINGS_PATH)).json()) as ListingsDocument;
		expect(body.listings).toHaveLength(1);
		const listing = body.listings[0] as ListingDocument;
		expect(listing.match.grain).toBe("card");
		expect(listing.match.cardKey).toBe("en:base2-44");
		expect(listing.match.variantId).toBeNull();
		expect(listing.match.candidates).toHaveLength(2);
		expect(listing.match.matcherVersion).toBeTruthy();
		expect(describeResolution(listing.match)).toContain("card");
		expect(describeResolution(listing.match)).toContain("en:base2-44");
	});

	it("does not write a copy when the feed resolves a card-grain listing", async () => {
		persist("v1|jungle|0", "Gloom Jungle 44/64");
		insertCopy(
			temp.handle.db,
			{
				id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				cardKey: "en:base2-44",
				variantId: FIRST_EDITION_VARIANT,
			},
			1,
		);
		const before = temp.handle.db.select().from(copies).all();

		await app().request(LISTINGS_PATH);
		await app().request(LISTINGS_PATH);

		expect(temp.handle.db.select().from(copies).all()).toEqual(before);
	});
});
