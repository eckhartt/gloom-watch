import { afterEach, describe, expect, it } from "vitest";
import { EbayClient } from "../server/ebay/client.ts";
import { PRODUCTION_API_ROOT } from "../server/ebay/credentials.ts";
import { EbayAuthError, EbayTokenStore } from "../server/ebay/oauth.ts";
import { FakeEbayFetch, FIXTURE_SALT, fixtureSummary } from "./helpers/fake-ebay.ts";

const credentials = {
	clientId: "id",
	clientSecret: "secret",
	relistHashSalt: FIXTURE_SALT,
	apiRoot: PRODUCTION_API_ROOT,
};

describe("client-credentials OAuth", () => {
	it("mints an application token and reuses it", async () => {
		const fake = new FakeEbayFetch();
		const store = new EbayTokenStore(credentials, fake.fetch);

		expect(await store.bearer()).toBe("fixture-access-token");
		expect(await store.bearer()).toBe("fixture-access-token");
		expect(fake.tokenMints).toBe(1);
	});

	it("remints after invalidate, not because expires_in elapsed", async () => {
		const fake = new FakeEbayFetch();
		const store = new EbayTokenStore(credentials, fake.fetch);

		await store.bearer();
		store.invalidate();
		await store.bearer();
		expect(fake.tokenMints).toBe(2);
	});

	it("surfaces a failed mint without leaking the secret", async () => {
		const fake = new FakeEbayFetch({ tokenStatus: 401 });
		const store = new EbayTokenStore(credentials, fake.fetch);

		await expect(store.bearer()).rejects.toBeInstanceOf(EbayAuthError);
		expect(String(await store.bearer().catch((error: Error) => error.message))).not.toContain(
			"secret",
		);
	});
});

describe("token remint on 401", () => {
	afterEach(() => {
		// The fake's fetch is per-test.
	});

	it("drops the cached token and retries the search once", async () => {
		const fake = new FakeEbayFetch();
		fake.unauthorizedOnce.add("/buy/browse/v1/item_summary/search");
		fake.setDefaultSummaries([fixtureSummary({ itemId: "v1|401|0" })]);
		const client = new EbayClient(credentials, fake.fetch, fake.sleep);

		const page = await client.search({
			marketplace: "US",
			categoryId: "183454",
			keyword: "Gloom",
			from: 1_700_000_000_000,
		});

		expect(page.items).toHaveLength(1);
		expect(page.calls).toBe(2);
		expect(fake.tokenMints).toBe(2);
	});
});
