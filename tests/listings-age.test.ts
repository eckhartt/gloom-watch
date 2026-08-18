import { describe, expect, it } from "vitest";
import { DISPLAY_FRESHNESS_MS, discloseAge } from "../shared/listings.ts";

describe("the six-hour age disclosure", () => {
	it("names minutes, hours and days rather than emitting a timestamp", () => {
		expect(discloseAge(30_000)).toBe("less than a minute old");
		expect(discloseAge(60_000)).toBe("1 minute old");
		expect(discloseAge(3_600_000)).toBe("1 hour old");
		expect(discloseAge(7 * 3_600_000)).toBe("7 hours old");
		expect(discloseAge(3 * 24 * 3_600_000)).toBe("3 days old");
	});

	it("treats six hours as the freshness bound, exclusive", () => {
		expect(DISPLAY_FRESHNESS_MS).toBe(6 * 60 * 60 * 1000);
		expect(discloseAge(DISPLAY_FRESHNESS_MS + 1)).toBe("6 hours old");
	});
});
