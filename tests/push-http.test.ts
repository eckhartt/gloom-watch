import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { pushSubscriptions } from "../server/db/schema.ts";
import type {
	PushConfigDocument,
	PushSubscriptionDocument,
	PushSubscriptionRequest,
} from "../shared/push.ts";
import { PUSH_CONFIG_PATH, PUSH_SUBSCRIPTIONS_PATH } from "../shared/push.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/** The two routes the phone talks to, against a real migrated SQLite database. */

const NOW = 1_800_000_000_000;

const VAPID_ENV = {
	VAPID_PUBLIC_KEY: "a-public-key",
	VAPID_PRIVATE_KEY: "a-private-key-that-must-never-be-served",
	VAPID_SUBJECT: "mailto:owner@example.org",
	// Points the environment-file loader at nothing, so this test cannot read the real box's file.
	GLOOM_WATCH_ENV_FILE: "/nonexistent/gloom-watch.env",
};

const subscription: PushSubscriptionRequest = {
	id: "11111111-1111-4111-8111-111111111111",
	endpoint: "https://web.push.apple.com/push/device-1",
	keys: { p256dh: "BP-device-public-key", auth: "device-auth-secret" },
	transport: "declarative",
	expirationTime: null,
	userAgent: "Mozilla/5.0 (iPhone)",
};

describe("the push routes", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
	});

	afterEach(() => {
		temp.dispose();
	});

	function app(env: Record<string, string | undefined> = VAPID_ENV) {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => NOW,
			env,
		});
	}

	function post(body: unknown, env?: Record<string, string | undefined>) {
		return app(env).request(PUSH_SUBSCRIPTIONS_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: typeof body === "string" ? body : JSON.stringify(body),
		});
	}

	describe(`GET ${PUSH_CONFIG_PATH}`, () => {
		it("serves the public key, the TTL and the payload budget", async () => {
			const response = await app().request(PUSH_CONFIG_PATH);
			expect(response.status).toBe(200);

			const body = (await response.json()) as PushConfigDocument;
			expect(body.vapidPublicKey).toBe("a-public-key");
			expect(body.ttlSeconds).toBeGreaterThan(0);
			expect(body.maxPayloadBytes).toBeGreaterThan(0);
		});

		it("never serves the private key", async () => {
			const response = await app().request(PUSH_CONFIG_PATH);
			expect(await response.text()).not.toContain(VAPID_ENV.VAPID_PRIVATE_KEY);
		});

		it("is never cached — a stale key produces VapidPkHashMismatch with no visible cause", async () => {
			const response = await app().request(PUSH_CONFIG_PATH);
			expect(response.headers.get("cache-control")).toBe("no-store");
		});

		it("reports a null key rather than failing when the environment is not set up", async () => {
			const response = await app({ GLOOM_WATCH_ENV_FILE: "/nonexistent/gloom-watch.env" }).request(
				PUSH_CONFIG_PATH,
			);
			const body = (await response.json()) as PushConfigDocument;
			expect(body.vapidPublicKey).toBeNull();
		});
	});

	describe(`POST ${PUSH_SUBSCRIPTIONS_PATH}`, () => {
		it("stores the subscription and echoes back its identity", async () => {
			const response = await post(subscription);
			expect(response.status).toBe(200);

			const body = (await response.json()) as PushSubscriptionDocument;
			expect(body.id).toBe(subscription.id);
			expect(body.transport).toBe("declarative");
			expect(body.createdAt).toBe(NOW);
			expect(body.lastSuccessAt).toBeNull();

			const rows = temp.handle.db.select().from(pushSubscriptions).all();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.endpoint).toBe(subscription.endpoint);
			expect(rows[0]?.p256dh).toBe(subscription.keys.p256dh);
		});

		it("is idempotent on the endpoint, so a replayed registration yields one row", async () => {
			await post(subscription);
			// A second subscribe on the same device mints a new client-side identifier; the endpoint
			// is what the push service issued and is the identity that matters.
			const response = await post({ ...subscription, id: "22222222-2222-4222-8222-222222222222" });

			expect(response.status).toBe(200);
			const rows = temp.handle.db.select().from(pushSubscriptions).all();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.id).toBe(subscription.id);
		});

		it("defaults an absent transport to classic, the shape that works everywhere", async () => {
			const { transport: _dropped, ...withoutTransport } = subscription;
			const response = await post(withoutTransport);

			const body = (await response.json()) as PushSubscriptionDocument;
			expect(body.transport).toBe("classic");
		});

		it("mints an identifier when the client does not supply one", async () => {
			const { id: _dropped, ...withoutId } = subscription;
			const body = (await (await post(withoutId)).json()) as PushSubscriptionDocument;
			expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
		});

		it.each([
			["a body that is not JSON", "not json at all"],
			["no endpoint", { keys: subscription.keys }],
			["an endpoint that is not a URL", { endpoint: "device-1", keys: subscription.keys }],
			["a plaintext endpoint", { endpoint: "http://example.org/p", keys: subscription.keys }],
			["no keys", { endpoint: subscription.endpoint }],
			["no auth secret", { endpoint: subscription.endpoint, keys: { p256dh: "x" } }],
			["an unknown transport", { ...subscription, transport: "carrier-pigeon" }],
		])("rejects %s with a 400", async (_label, body) => {
			const response = await post(body);
			expect(response.status).toBe(400);
			expect(temp.handle.db.select().from(pushSubscriptions).all()).toHaveLength(0);
		});
	});
});
