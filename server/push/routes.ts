import { Hono } from "hono";
import type { PushConfigDocument } from "../../shared/push.ts";
import { PUSH_PAYLOAD_MAX_BYTES, PUSH_TTL_SECONDS } from "../../shared/push.ts";
import type { DatabaseHandle } from "../db/client.ts";
import {
	InvalidSubscriptionError,
	parseSubscriptionRequest,
	toSubscriptionDocument,
	upsertSubscription,
} from "./subscriptions.ts";
import { readVapidPublicKey } from "./vapid.ts";

/**
 * The two routes the phone needs: fetch the application server key, then hand back the
 * subscription it took with it.
 *
 * There is deliberately **no route that sends a push**. The demo is triggered by hand from the
 * server (`bun run push:test`), and a send endpoint reachable from the phone would let a stray
 * reload spend part of a three-strike budget that never refills.
 */

export interface PushRouteDependencies {
	readonly handle: DatabaseHandle;
	readonly now?: () => number;
	/** Injected so a test can supply a VAPID environment without touching `process.env`. */
	readonly env?: Record<string, string | undefined>;
}

export function createPushRoutes(deps: PushRouteDependencies): Hono {
	const now = deps.now ?? (() => Date.now());
	const routes = new Hono();

	routes.get("/config", (c) => {
		const body: PushConfigDocument = {
			// The public half only. There is no route, log line or document that carries the private
			// key, and there must never be one.
			vapidPublicKey: readVapidPublicKey(deps.env),
			ttlSeconds: PUSH_TTL_SECONDS,
			maxPayloadBytes: PUSH_PAYLOAD_MAX_BYTES,
		};
		// Never cached: a stale application server key produces `VapidPkHashMismatch` on every send
		// and no visible cause.
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});

	routes.post("/subscriptions", async (c) => {
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parseSubscriptionRequest(payload);
			const row = upsertSubscription(deps.handle.db, request, now());
			c.header("Cache-Control", "no-store");
			return c.json(toSubscriptionDocument(row));
		} catch (cause) {
			if (cause instanceof InvalidSubscriptionError) {
				return c.json({ error: cause.message }, 400);
			}
			throw cause;
		}
	});

	return routes;
}
