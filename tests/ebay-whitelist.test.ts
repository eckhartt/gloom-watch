import { describe, expect, it } from "vitest";
import { hashSellerUsername } from "../server/ebay/seller-hash.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import { FIXTURE_SALT, FIXTURE_SELLER, fixtureSummary } from "./helpers/fake-ebay.ts";

describe("the field whitelist", () => {
	it("keeps the matcher inputs and drops the seller object", () => {
		const observed = whitelistItem(
			fixtureSummary({
				itemId: "v1|1|0",
				localizedAspects: [{ name: "Character", value: "Gloom" }],
			}),
			FIXTURE_SALT,
		);

		expect(observed).toEqual({
			itemId: "v1|1|0",
			title: "Gloom Jungle 44/64",
			priceMinor: 1299,
			currency: "USD",
			buyingOption: "FIXED_PRICE",
			conditionId: 4000,
			itemWebUrl: "https://www.ebay.com/itm/v1|1|0",
			itemLocationCountry: "US",
			itemOriginDate: Date.parse("2026-08-18T00:00:00.000Z"),
			sellerHash: hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT),
			aspects: { Character: "Gloom" },
		});
		expect(JSON.stringify(observed)).not.toContain(FIXTURE_SELLER);
		expect(JSON.stringify(observed)).not.toContain("username");
	});

	it("does not map conditionId 4000 to a card condition", () => {
		// For trading cards 4000 means ungraded. The eBay label is "Very Good". Nothing here
		// translates it — the stored value is the integer, and the string never survives.
		const observed = whitelistItem(fixtureSummary({ itemId: "v1|2|0" }), FIXTURE_SALT);
		expect(observed?.conditionId).toBe(4000);
		expect(JSON.stringify(observed)).not.toContain("Very Good");
	});

	it("returns null when the summary has no identity", () => {
		expect(whitelistItem({ title: "Gloom" }, FIXTURE_SALT)).toBeNull();
	});
});
