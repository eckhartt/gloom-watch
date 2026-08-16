import { afterEach, beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";
import { pushSubscriptions } from "../server/db/schema.ts";
import { sendPushToEverySubscription, sendPushToSubscription } from "../server/push/send.ts";
import {
	listLiveSubscriptions,
	recentPushEchoes,
	upsertSubscription,
} from "../server/push/subscriptions.ts";
import type { VapidConfig } from "../server/push/vapid.ts";
import type { PushNotificationContent, PushTransport } from "../shared/push.ts";
import { PUSH_PAYLOAD_MAX_BYTES } from "../shared/push.ts";
import {
	createFakeDevice,
	type FakePushService,
	startFakePushService,
} from "./helpers/push-receiver.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The send path, end to end, against a stand-in push service — real VAPID signing, real RFC 8291
 * encryption, a real HTTP request, and a real decryption on the other side.
 *
 * This is as far as the transport can be proved without a physical iPhone. What it *does* prove is
 * the part that must not be discovered on the device: that the bytes the phone will decrypt are
 * exactly the payload the sender built, in the shape the subscription said it could render.
 */

const VAPID: VapidConfig = {
	...webpush.generateVAPIDKeys(),
	subject: "mailto:gloom-watch@example.org",
};

const NOW = 1_800_000_000_000;

const content: PushNotificationContent = {
	title: "Gloom — Jungle JA holo",
	body: "¥4,200 — ungraded — auction 3d",
	navigate: "https://htpc.tail594f35.ts.net/listings/abc123",
	lang: "ja",
};

describe("sending a push", () => {
	let temp: TempDatabase;
	let service: FakePushService;
	let device: ReturnType<typeof createFakeDevice>;

	beforeEach(() => {
		temp = createTempDatabase();
		service = startFakePushService();
		device = createFakeDevice();
	});

	afterEach(async () => {
		await service.stop();
		temp.dispose();
	});

	function register(transport: PushTransport) {
		return upsertSubscription(
			temp.handle.db,
			{
				endpoint: `${service.origin}/push/device-1`,
				keys: { p256dh: device.p256dh, auth: device.auth },
				transport,
			},
			NOW,
		);
	}

	function send(transport: PushTransport, kind = "test") {
		return sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			register(transport),
			{
				content,
				kind,
			},
		);
	}

	it("delivers a declarative payload the device can decrypt byte for byte", async () => {
		const outcome = await send("declarative");

		expect(outcome.accepted).toBe(true);
		expect(outcome.statusCode).toBe(201);
		expect(service.received).toHaveLength(1);

		const plaintext = device.decrypt(service.received[0]?.body as Uint8Array);
		expect(JSON.parse(plaintext)).toEqual({
			web_push: 8030,
			notification: {
				title: content.title,
				body: content.body,
				navigate: content.navigate,
				silent: false,
				lang: "ja",
			},
		});
	});

	it("delivers the classic shape to a classic subscription and never the declarative one", async () => {
		await send("classic");

		const plaintext = device.decrypt(service.received[0]?.body as Uint8Array);
		expect(plaintext).not.toContain("web_push");
		expect(JSON.parse(plaintext)).toEqual({
			title: content.title,
			body: content.body,
			navigate: content.navigate,
			lang: "ja",
		});
	});

	it("sets a positive TTL, aes128gcm encoding and a VAPID Authorization header", async () => {
		await send("declarative");
		const headers = service.received[0]?.headers as Record<string, string>;

		// A non-positive TTL is answered with BadTtl and delivers nothing.
		expect(Number(headers.ttl)).toBeGreaterThan(0);
		expect(headers["content-encoding"]).toBe("aes128gcm");
		expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
		expect(headers.authorization).toContain(VAPID.publicKey);
		expect(headers.urgency).toBe("high");
	});

	it("never puts the private key on the wire", async () => {
		await send("declarative");
		const serialised = JSON.stringify(service.received[0]?.headers);
		expect(serialised).not.toContain(VAPID.privateKey);
	});

	it("signs a JWT whose audience is the push service's origin", async () => {
		await send("declarative");
		const authorization = service.received[0]?.headers.authorization as string;
		const token = authorization.slice("vapid t=".length, authorization.indexOf(", k="));
		const claims = JSON.parse(
			Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"),
		);

		expect(claims.aud).toBe(service.origin);
		expect(claims.sub).toBe(VAPID.subject);
		expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
	});
});

describe("the echo log", () => {
	let temp: TempDatabase;
	let service: FakePushService;
	let device: ReturnType<typeof createFakeDevice>;

	beforeEach(() => {
		temp = createTempDatabase();
		service = startFakePushService();
		device = createFakeDevice();
	});

	afterEach(async () => {
		await service.stop();
		temp.dispose();
	});

	function register(endpointSuffix = "device-1", transport: PushTransport = "declarative") {
		return upsertSubscription(
			temp.handle.db,
			{
				endpoint: `${service.origin}/push/${endpointSuffix}`,
				keys: { p256dh: device.p256dh, auth: device.auth },
				transport,
			},
			NOW,
		);
	}

	it("records the size, the transport and the endpoint's answer", async () => {
		service.respondWith(201);
		await sendPushToSubscription({ db: temp.handle.db, vapid: VAPID, now: () => NOW }, register(), {
			content,
			kind: "test",
		});

		const [echo] = recentPushEchoes(temp.handle.db);
		expect(echo?.kind).toBe("test");
		expect(echo?.transport).toBe("declarative");
		expect(echo?.title).toBe(content.title);
		expect(echo?.statusCode).toBe(201);
		expect(echo?.payloadBytes).toBeGreaterThan(0);
		expect(echo?.payloadBytes).toBeLessThan(PUSH_PAYLOAD_MAX_BYTES);
		expect(echo?.ttlSeconds).toBeGreaterThan(0);
		expect(echo?.sentAt).toBe(NOW);
	});

	it("records the push service's error body, which is where Apple names the fault", async () => {
		service.respondWith(400, "VapidPkHashMismatch");
		const outcome = await sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			register(),
			{ content, kind: "test" },
		);

		expect(outcome.accepted).toBe(false);
		const [echo] = recentPushEchoes(temp.handle.db);
		expect(echo?.statusCode).toBe(400);
		expect(echo?.responseBody).toBe("VapidPkHashMismatch");
	});

	it("records a push that never reached a service at all", async () => {
		const subscription = register();
		await service.stop();

		const outcome = await sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW, timeoutMs: 500 },
			subscription,
			{ content, kind: "test" },
		);

		expect(outcome.statusCode).toBeNull();
		expect(outcome.accepted).toBe(false);
		const [echo] = recentPushEchoes(temp.handle.db);
		expect(echo?.statusCode).toBeNull();
		expect(echo?.error).not.toBeNull();
	});

	it("records an over-budget payload without sending it", async () => {
		const outcome = await sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			register(),
			{ content: { ...content, body: "x".repeat(PUSH_PAYLOAD_MAX_BYTES) }, kind: "test" },
		);

		expect(service.received).toHaveLength(0);
		expect(outcome.accepted).toBe(false);
		expect(recentPushEchoes(temp.handle.db)[0]?.error).toMatch(/over the \d+-byte budget/);
	});

	it("writes one row per subscription when sending to everyone", async () => {
		register("device-1");
		register("device-2");

		const outcomes = await sendPushToEverySubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			{ content, kind: "test" },
		);

		expect(outcomes).toHaveLength(2);
		expect(service.received).toHaveLength(2);
		expect(recentPushEchoes(temp.handle.db)).toHaveLength(2);
	});
});

describe("a subscription the push service says is gone", () => {
	let temp: TempDatabase;
	let service: FakePushService;
	let device: ReturnType<typeof createFakeDevice>;

	beforeEach(() => {
		temp = createTempDatabase();
		service = startFakePushService();
		device = createFakeDevice();
	});

	afterEach(async () => {
		await service.stop();
		temp.dispose();
	});

	function register() {
		return upsertSubscription(
			temp.handle.db,
			{
				endpoint: `${service.origin}/push/device-1`,
				keys: { p256dh: device.p256dh, auth: device.auth },
				transport: "declarative",
			},
			NOW,
		);
	}

	it.each([404, 410])("is retired on a %i", async (status) => {
		service.respondWith(status);
		const outcome = await sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			register(),
			{ content, kind: "test" },
		);

		expect(outcome.retired).toBe(true);
		expect(listLiveSubscriptions(temp.handle.db)).toHaveLength(0);
		// Retired, not deleted: the echo log points at it and that history is the only
		// after-the-fact evidence this transport produces.
		expect(temp.handle.db.select().from(pushSubscriptions).all()).toHaveLength(1);
	});

	it("survives a 500, because a server error is not evidence of death", async () => {
		service.respondWith(500, "try again");
		const outcome = await sendPushToSubscription(
			{ db: temp.handle.db, vapid: VAPID, now: () => NOW },
			register(),
			{ content, kind: "test" },
		);

		expect(outcome.retired).toBe(false);
		expect(listLiveSubscriptions(temp.handle.db)).toHaveLength(1);
	});

	it("comes back when the device re-subscribes to the same endpoint", async () => {
		service.respondWith(410);
		await sendPushToSubscription({ db: temp.handle.db, vapid: VAPID, now: () => NOW }, register(), {
			content,
			kind: "test",
		});
		expect(listLiveSubscriptions(temp.handle.db)).toHaveLength(0);

		register();
		expect(listLiveSubscriptions(temp.handle.db)).toHaveLength(1);
	});
});
