import { describe, expect, it } from "vitest";
import {
	EbayNotConfiguredError,
	loadEbayCredentials,
	PRODUCTION_API_ROOT,
	SANDBOX_API_ROOT,
	tryLoadEbayCredentials,
} from "../server/ebay/credentials.ts";

describe("eBay credentials", () => {
	it("loads production by default", () => {
		const loaded = loadEbayCredentials({
			EBAY_CLIENT_ID: "id",
			EBAY_CLIENT_SECRET: "secret",
			RELIST_HASH_SALT: "salt",
		});
		expect(loaded.apiRoot).toBe(PRODUCTION_API_ROOT);
	});

	it("points at sandbox when asked", () => {
		expect(
			loadEbayCredentials({
				EBAY_CLIENT_ID: "id",
				EBAY_CLIENT_SECRET: "secret",
				RELIST_HASH_SALT: "salt",
				EBAY_ENV: "sandbox",
			}).apiRoot,
		).toBe(SANDBOX_API_ROOT);
	});

	it("returns null rather than throwing when the cron job has no keyset", () => {
		expect(tryLoadEbayCredentials({})).toBeNull();
		expect(() => loadEbayCredentials({})).toThrow(EbayNotConfiguredError);
	});
});
