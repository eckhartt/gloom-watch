import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
	isPushTransport,
	type PushSubscriptionDocument,
	type PushSubscriptionRequest,
} from "../../shared/push.ts";
import type { GloomDatabase } from "../db/client.ts";
import {
	type PushEchoLogRow,
	type PushSubscriptionRow,
	pushEchoLog,
	pushSubscriptions,
} from "../db/schema.ts";

/** Reading and writing the two push tables. No HTTP, no crypto, no network. */

export class InvalidSubscriptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidSubscriptionError";
	}
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidSubscriptionError(`${field} is required and must be a non-empty string`);
	}
	return value;
}

/**
 * Validate a posted `PushSubscription`.
 *
 * **A missing transport means classic.** The spec is explicit: classic works everywhere, where a
 * declarative payload to a client that cannot render it is a silent failure. Guessing the safe
 * way costs one device the exemption; guessing the other way costs it every notification.
 */
export function parseSubscriptionRequest(body: unknown): PushSubscriptionRequest {
	if (typeof body !== "object" || body === null) {
		throw new InvalidSubscriptionError("the request body must be a JSON object");
	}
	const raw = body as Record<string, unknown>;

	const endpoint = requiredString(raw.endpoint, "endpoint");
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new InvalidSubscriptionError("endpoint must be an absolute URL");
	}
	if (parsed.protocol !== "https:") {
		throw new InvalidSubscriptionError("endpoint must be https");
	}

	const keys = raw.keys;
	if (typeof keys !== "object" || keys === null) {
		throw new InvalidSubscriptionError("keys is required; the subscription cannot be encrypted to");
	}
	const keyRecord = keys as Record<string, unknown>;

	if (raw.transport !== undefined && !isPushTransport(raw.transport)) {
		throw new InvalidSubscriptionError(
			`transport must be "declarative" or "classic", got ${JSON.stringify(raw.transport)}`,
		);
	}

	const expirationTime = raw.expirationTime;
	if (
		expirationTime !== undefined &&
		expirationTime !== null &&
		typeof expirationTime !== "number"
	) {
		throw new InvalidSubscriptionError("expirationTime must be a number or null");
	}

	return {
		...(typeof raw.id === "string" && raw.id !== "" ? { id: raw.id } : {}),
		endpoint,
		keys: {
			p256dh: requiredString(keyRecord.p256dh, "keys.p256dh"),
			auth: requiredString(keyRecord.auth, "keys.auth"),
		},
		transport: isPushTransport(raw.transport) ? raw.transport : "classic",
		expirationTime: typeof expirationTime === "number" ? expirationTime : null,
		userAgent: typeof raw.userAgent === "string" ? raw.userAgent.slice(0, 300) : null,
	};
}

/**
 * Register a subscription, or update the one already holding this endpoint.
 *
 * Idempotent on `endpoint`, which is the identity the push service issued: re-subscribing on the
 * same device yields one row, keeping the identifier the echo log already points at. A repeat
 * also clears any retirement — if the push service handed the endpoint back, it is live again.
 */
export function upsertSubscription(
	db: GloomDatabase,
	request: PushSubscriptionRequest,
	now: number,
): PushSubscriptionRow {
	const rows = db
		.insert(pushSubscriptions)
		.values({
			id: request.id ?? randomUUID(),
			endpoint: request.endpoint,
			p256dh: request.keys.p256dh,
			auth: request.keys.auth,
			transport: request.transport ?? "classic",
			expirationTime: request.expirationTime ?? null,
			userAgent: request.userAgent ?? null,
			createdAt: now,
			updatedAt: now,
			lastSuccessAt: null,
			retiredAt: null,
			retiredStatus: null,
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: {
				p256dh: sql`excluded.p256dh`,
				auth: sql`excluded.auth`,
				transport: sql`excluded.transport`,
				expirationTime: sql`excluded.expiration_time`,
				userAgent: sql`excluded.user_agent`,
				updatedAt: sql`excluded.updated_at`,
				retiredAt: sql`NULL`,
				retiredStatus: sql`NULL`,
			},
		})
		.returning()
		.all();

	const row = rows[0];
	if (row === undefined) {
		throw new Error("the subscription upsert returned no row");
	}
	return row;
}

/** Everything a push may be sent to: registered, and not proved gone by a 404 or 410. */
export function listLiveSubscriptions(db: GloomDatabase): PushSubscriptionRow[] {
	return db.select().from(pushSubscriptions).where(isNull(pushSubscriptions.retiredAt)).all();
}

export function findSubscription(db: GloomDatabase, id: string): PushSubscriptionRow | null {
	return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get() ?? null;
}

/**
 * Mark an endpoint gone. Called only on a `404` or `410`, which are the push service's two ways
 * of saying the subscription no longer exists. **Every other failure leaves the row alone** —
 * absence of a 410 is not evidence of life, but a 500 is not evidence of death either.
 */
export function retireSubscription(
	db: GloomDatabase,
	id: string,
	statusCode: number,
	now: number,
): void {
	db.update(pushSubscriptions)
		.set({ retiredAt: now, retiredStatus: statusCode, updatedAt: now })
		.where(and(eq(pushSubscriptions.id, id), isNull(pushSubscriptions.retiredAt)))
		.run();
}

/** The push service accepted the message. Acceptance, not delivery — nothing here proves a buzz. */
export function markSubscriptionAccepted(db: GloomDatabase, id: string, now: number): void {
	db.update(pushSubscriptions)
		.set({ lastSuccessAt: now, updatedAt: now })
		.where(eq(pushSubscriptions.id, id))
		.run();
}

export type PushEchoDraft = Omit<PushEchoLogRow, "id">;

export function recordPushEcho(db: GloomDatabase, draft: PushEchoDraft): PushEchoLogRow {
	const rows = db
		.insert(pushEchoLog)
		.values({ id: randomUUID(), ...draft })
		.returning()
		.all();

	const row = rows[0];
	if (row === undefined) {
		throw new Error("the echo log insert returned no row");
	}
	return row;
}

export function recentPushEchoes(db: GloomDatabase, limit = 20): PushEchoLogRow[] {
	return db.select().from(pushEchoLog).orderBy(desc(pushEchoLog.sentAt)).limit(limit).all();
}

export function toSubscriptionDocument(row: PushSubscriptionRow): PushSubscriptionDocument {
	return {
		id: row.id,
		transport: row.transport,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastSuccessAt: row.lastSuccessAt,
	};
}
