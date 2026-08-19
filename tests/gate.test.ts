import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { sessionToken } from "../server/gate.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import {
	EBAY_ACCOUNT_DELETION_PATH,
	GATE_COOKIE,
	UNLOCK_API_PATH,
	UNLOCK_PATH,
} from "../shared/gate.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const SECRET = "test-shared-secret";
const ORIGIN = "https://cards.example";

describe("the shared-secret gate", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "UTC", 1);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app(env: Record<string, string | undefined> = { GLOOM_WATCH_SHARED_SECRET: SECRET }) {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			publicOrigin: ORIGIN,
			env,
		});
	}

	it("is a no-op when no secret is configured, so development machines stay open", async () => {
		const response = await app({}).request(HEALTH_PATH);
		expect(response.status).toBe(200);
	});

	it("rejects /api without a cookie once a secret is set", async () => {
		const response = await app().request(HEALTH_PATH);
		expect(response.status).toBe(401);
		const body = (await response.json()) as { unlock: string };
		expect(body.unlock).toBe(UNLOCK_API_PATH);
	});

	it("lets the unlock form and the eBay callback through without a cookie", async () => {
		const unlock = await app().request(UNLOCK_PATH);
		expect(unlock.status).toBe(200);
		expect(await unlock.text()).toContain("Shared secret");

		const apiUnlock = await app().request(UNLOCK_API_PATH);
		expect(apiUnlock.status).toBe(200);
		expect(await apiUnlock.text()).toContain("Shared secret");

		const challenge = await app({
			GLOOM_WATCH_SHARED_SECRET: SECRET,
			EBAY_NOTIFICATION_VERIFICATION_TOKEN: "a".repeat(32),
		}).request(`${EBAY_ACCOUNT_DELETION_PATH}?challenge_code=abc`);
		expect(challenge.status).toBe(200);
	});

	it("sets the cookie when the secret matches and then serves /api", async () => {
		const unlocked = await app().request(UNLOCK_API_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ secret: SECRET }),
		});
		expect(unlocked.status).toBe(303);
		const cookie = unlocked.headers.get("set-cookie") ?? "";
		expect(cookie).toContain(`${GATE_COOKIE}=${sessionToken(SECRET)}`);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");

		const health = await app().request(HEALTH_PATH, {
			headers: { cookie: `${GATE_COOKIE}=${sessionToken(SECRET)}` },
		});
		expect(health.status).toBe(200);
	});

	it("rejects the wrong secret", async () => {
		const response = await app().request(UNLOCK_API_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ secret: "nope" }),
		});
		expect(response.status).toBe(401);
	});

	it("accepts the secret as a bearer token", async () => {
		const response = await app().request(HEALTH_PATH, {
			headers: { authorization: `Bearer ${SECRET}` },
		});
		expect(response.status).toBe(200);
	});
});
