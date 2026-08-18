import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { listings } from "../server/db/schema.ts";
import { challengeResponse, notificationEndpoint } from "../server/ebay/notifications.ts";
import { everyPersistedText, upsertObserved } from "../server/ebay/repository.ts";
import { hashSellerUsername } from "../server/ebay/seller-hash.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import { EBAY_ACCOUNT_DELETION_PATH } from "../shared/gate.ts";
import { FIXTURE_SALT, FIXTURE_SELLER, fixtureSummary } from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const ORIGIN = "https://cards.example";
const TOKEN = "verification-token-32-characters!!";

describe("eBay account-deletion notifications", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "UTC", 1);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			publicOrigin: ORIGIN,
			env: {
				EBAY_NOTIFICATION_VERIFICATION_TOKEN: TOKEN,
				RELIST_HASH_SALT: FIXTURE_SALT,
			},
		});
	}

	it("answers the challenge with SHA-256(challenge + token + endpoint)", async () => {
		const challenge = "challenge-code-from-ebay";
		const response = await app().request(
			`${EBAY_ACCOUNT_DELETION_PATH}?challenge_code=${challenge}`,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { challengeResponse: string };
		const endpoint = notificationEndpoint(ORIGIN);
		expect(body.challengeResponse).toBe(challengeResponse(challenge, TOKEN, endpoint));
		expect(body.challengeResponse).toBe(
			createHash("sha256")
				.update(challenge + TOKEN + endpoint)
				.digest("hex"),
		);
		expect(endpoint).toBe(`${ORIGIN}${EBAY_ACCOUNT_DELETION_PATH}`);
	});

	it("drops listings whose seller hash matches and never stores the username", async () => {
		const observed = whitelistItem(fixtureSummary({ itemId: "v1|forget-me|0" }), FIXTURE_SALT);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "US", 1_800_000_000_000);
		expect(temp.handle.db.select().from(listings).all()).toHaveLength(1);
		expect(observed.sellerHash).toBe(hashSellerUsername(FIXTURE_SELLER, FIXTURE_SALT));

		const response = await app().request(EBAY_ACCOUNT_DELETION_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0.0" },
				notification: {
					notificationId: "n1",
					eventDate: "2026-08-18T00:00:00Z",
					publishDate: "2026-08-18T00:00:01Z",
					publishAttemptCount: 1,
					data: { username: FIXTURE_SELLER, userId: "u1", eiasToken: "t1" },
				},
			}),
		});
		expect(response.status).toBe(204);
		expect(temp.handle.db.select().from(listings).all()).toEqual([]);
		expect(
			everyPersistedText(temp.handle.sqlite).some((value) => value.includes(FIXTURE_SELLER)),
		).toBe(false);
	});
});
