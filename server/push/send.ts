import webpush from "web-push";
import type { PushNotificationContent, PushTransport } from "../../shared/push.ts";
import {
	PUSH_TTL_SECONDS,
	PushPayloadTooLargeError,
	serialisePushPayload,
} from "../../shared/push.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { PushSubscriptionRow } from "../db/schema.ts";
import {
	listLiveSubscriptions,
	markSubscriptionAccepted,
	recordPushEcho,
	retireSubscription,
} from "./subscriptions.ts";
import type { VapidConfig } from "./vapid.ts";

/**
 * Encrypt a payload and hand it to the push service.
 *
 * `web-push` does the dangerous half — RFC 8291 message encryption and the VAPID JWT — and
 * `fetch` does the transport. Splitting them is deliberate:
 *
 * - `fetch` is standard, so the sender adds no Bun-specific API beyond the two the spec allows,
 *   and the retreat to Node stays cheap.
 * - The response status and body land in the echo log directly, rather than being flattened into
 *   a thrown `WebPushError` and reconstructed.
 * - The socket timeout becomes an `AbortSignal`, which is one mechanism instead of two.
 *
 * **Reachability at send time is outbound only.** The server is the HTTP client here and the
 * payload is encrypted end to end, so the box needs nothing inbound from the internet. Tapping
 * the notification is the half that needs the tailnet.
 */

/**
 * Ask the push service to deliver immediately rather than batching for the device's power
 * budget. Correct for the test push and for an instant listing alert; the digest sender may want
 * `normal` when it arrives.
 */
export const PUSH_URGENCY = "high" as const;

/** Enough for Apple's error bodies, which are short and name the fault. */
const RESPONSE_BODY_LIMIT = 500;

const DEFAULT_TIMEOUT_MS = 10_000;

export interface PushSenderOptions {
	readonly db: GloomDatabase;
	readonly vapid: VapidConfig;
	/** Injected so tests drive time without a global clock mock, matching the rest of the server. */
	readonly now?: () => number;
	readonly ttlSeconds?: number;
	readonly timeoutMs?: number;
	/** Injected so a test can point the sender at a local capture server. */
	readonly fetch?: typeof globalThis.fetch;
}

export interface PushSendRequest {
	readonly content: PushNotificationContent;
	/** What prompted this push. `test`, `instant`; `digest` and `gap-recovery` later. */
	readonly kind: string;
}

export interface PushSendOutcome {
	readonly subscriptionId: string;
	readonly transport: PushTransport;
	readonly payloadBytes: number;
	readonly statusCode: number | null;
	/** The push service accepted the message. It says nothing about the device displaying it. */
	readonly accepted: boolean;
	/** The endpoint is gone and the row has been retired. */
	readonly retired: boolean;
	readonly error: string | null;
	readonly echoId: string;
}

function assertPositiveTtl(ttlSeconds: number): void {
	if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
		throw new Error(
			`push TTL must be a positive integer number of seconds, got ${ttlSeconds}; Apple answers ` +
				"a non-positive TTL with BadTtl and delivers nothing.",
		);
	}
}

/** `generateRequestDetails` returns numbers for `TTL` and `Content-Length`; `fetch` wants strings. */
function headersForFetch(headers: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

/**
 * Send one push and record it, whatever happens.
 *
 * Never throws for a delivery failure: a failure that vanishes is worse than one written down,
 * and the echo log is the only after-the-fact evidence this transport produces. It does throw if
 * the configuration is wrong — a non-positive TTL is a bug, not an outcome.
 */
export async function sendPushToSubscription(
	options: PushSenderOptions,
	subscription: PushSubscriptionRow,
	request: PushSendRequest,
): Promise<PushSendOutcome> {
	const now = options.now ?? (() => Date.now());
	const ttlSeconds = options.ttlSeconds ?? PUSH_TTL_SECONDS;
	const doFetch = options.fetch ?? globalThis.fetch;
	assertPositiveTtl(ttlSeconds);

	const startedAt = now();

	const record = (fields: {
		transport: PushTransport;
		payloadBytes: number;
		statusCode: number | null;
		responseBody: string | null;
		error: string | null;
	}): PushSendOutcome => {
		const echo = recordPushEcho(options.db, {
			subscriptionId: subscription.id,
			sentAt: startedAt,
			kind: request.kind,
			transport: fields.transport,
			title: request.content.title,
			payloadBytes: fields.payloadBytes,
			ttlSeconds,
			statusCode: fields.statusCode,
			responseBody: fields.responseBody,
			error: fields.error,
			durationMs: now() - startedAt,
		});

		const accepted =
			fields.statusCode !== null && fields.statusCode >= 200 && fields.statusCode < 300;
		const gone = fields.statusCode === 404 || fields.statusCode === 410;

		if (accepted) markSubscriptionAccepted(options.db, subscription.id, now());
		// 404 and 410 are the push service's two ways of saying the endpoint no longer exists.
		// Nothing else retires a row: a 500 is not evidence of death.
		if (gone) retireSubscription(options.db, subscription.id, fields.statusCode as number, now());

		return {
			subscriptionId: subscription.id,
			transport: fields.transport,
			payloadBytes: fields.payloadBytes,
			statusCode: fields.statusCode,
			accepted,
			retired: gone,
			error: fields.error,
			echoId: echo.id,
		};
	};

	// One shape, never both: the subscription says what the device can render.
	let serialised: ReturnType<typeof serialisePushPayload>;
	try {
		serialised = serialisePushPayload(request.content, subscription.transport);
	} catch (cause) {
		const message =
			cause instanceof PushPayloadTooLargeError
				? cause.message
				: `could not build the payload: ${(cause as Error).message}`;
		return record({
			transport: subscription.transport,
			payloadBytes: cause instanceof PushPayloadTooLargeError ? cause.bytes : 0,
			statusCode: null,
			responseBody: null,
			error: message,
		});
	}

	const details = webpush.generateRequestDetails(
		{
			endpoint: subscription.endpoint,
			keys: { p256dh: subscription.p256dh, auth: subscription.auth },
		},
		serialised.body,
		{
			TTL: ttlSeconds,
			contentEncoding: "aes128gcm",
			urgency: PUSH_URGENCY,
			vapidDetails: {
				subject: options.vapid.subject,
				publicKey: options.vapid.publicKey,
				privateKey: options.vapid.privateKey,
			},
		},
	);

	try {
		const response = await doFetch(details.endpoint, {
			method: "POST",
			headers: headersForFetch(details.headers),
			body: details.body,
			signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
		const responseBody = (await response.text()).slice(0, RESPONSE_BODY_LIMIT);

		return record({
			transport: serialised.transport,
			payloadBytes: serialised.bytes,
			statusCode: response.status,
			responseBody: responseBody === "" ? null : responseBody,
			error: null,
		});
	} catch (cause) {
		// No response at all: a timeout, DNS, a dead link. The row still gets written.
		return record({
			transport: serialised.transport,
			payloadBytes: serialised.bytes,
			statusCode: null,
			responseBody: null,
			error: (cause as Error).message,
		});
	}
}

/**
 * Send to every live subscription, one after another.
 *
 * Sequential rather than parallel: there is one device, so concurrency buys nothing, and a serial
 * loop keeps the echo log's ordering meaningful.
 */
export async function sendPushToEverySubscription(
	options: PushSenderOptions,
	request: PushSendRequest,
): Promise<PushSendOutcome[]> {
	const outcomes: PushSendOutcome[] = [];
	for (const subscription of listLiveSubscriptions(options.db)) {
		outcomes.push(await sendPushToSubscription(options, subscription, request));
	}
	return outcomes;
}
