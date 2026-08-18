import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashSellerUsername } from "../server/ebay/seller-hash.ts";
import { FIXTURE_SALT, FIXTURE_SELLER } from "./helpers/fake-ebay.ts";

describe("the relist seller hash", () => {
	it("is HMAC-SHA-256 keyed by the configured salt", () => {
		const expected = createHmac("sha256", FIXTURE_SALT)
			.update(FIXTURE_SELLER, "utf8")
			.digest("hex");
		expect(hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT)).toBe(expected);
		expect(expected).toHaveLength(64);
	});

	it("changes when the salt changes, so a lost salt cannot be guessed from old hashes", () => {
		expect(hashSellerUsername(FIXTURE_SELLER, "other-salt")).not.toBe(
			hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT),
		);
	});
});
