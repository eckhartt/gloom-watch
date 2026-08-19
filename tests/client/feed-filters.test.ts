import { describe, expect, it } from "vitest";
import { parseFeedSearch, searchFromFeed, toggleMarketplace } from "../../client/feed-filters.ts";

describe("feed marketplace filters", () => {
	it("is total over junk URL input", () => {
		expect(parseFeedSearch({ marketplace: "XX" })).toEqual({ marketplace: [] });
		expect(parseFeedSearch({ marketplace: ["AU", "nope", "US"] }).marketplace).toEqual([
			"AU",
			"US",
		]);
	});

	it("round-trips the URL", () => {
		const filters = { marketplace: ["AU", "US"] as const };
		expect(parseFeedSearch({ ...searchFromFeed(filters) })).toEqual(filters);
		expect(searchFromFeed({ marketplace: [] })).toEqual({ marketplace: [] });
	});

	it("toggles a marketplace on and off", () => {
		const on = toggleMarketplace({ marketplace: [] }, "AU");
		expect(on.marketplace).toEqual(["AU"]);
		expect(toggleMarketplace(on, "AU").marketplace).toEqual([]);
	});
});
