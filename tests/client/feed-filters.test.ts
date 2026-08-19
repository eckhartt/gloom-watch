import { describe, expect, it } from "vitest";
import { parseFeedSearch, searchFromFeed, toggleLocation } from "../../client/feed-filters.ts";

describe("feed location filters", () => {
	it("defaults a bare /feed to AU", () => {
		expect(parseFeedSearch({})).toEqual({ location: ["AU"] });
	});

	it("treats an explicit empty location as every country", () => {
		expect(parseFeedSearch({ location: [] })).toEqual({ location: [] });
	});

	it("is total over junk URL input", () => {
		expect(parseFeedSearch({ location: "XXX" })).toEqual({ location: [] });
		expect(parseFeedSearch({ location: ["au", "nope", "JP"] }).location).toEqual(["AU", "JP"]);
	});

	it("toggles a country on and off", () => {
		const on = toggleLocation({ location: ["AU"] }, "US");
		expect(on.location).toEqual(["AU", "US"]);
		expect(toggleLocation(on, "AU").location).toEqual(["US"]);
		expect(searchFromFeed(on)).toEqual(on);
	});
});
