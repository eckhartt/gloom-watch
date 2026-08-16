/**
 * The push wire contract.
 *
 * Two payload shapes exist and **exactly one is sent to any given subscription**:
 *
 * - **Declarative Web Push** (iOS 18.4+). The user agent renders the notification itself from
 *   JSON. It is *exempt from the silent-push penalty* because no `push` event reaches the
 *   service worker at all, which is the strongest reliability property available on iOS.
 * - **Classic**. A private JSON shape our own service worker parses and hands to
 *   `showNotification()`. It is the fallback for iOS 16.4–18.3, where declarative JSON would
 *   simply fail to display.
 *
 * The subscription records which one the device supports. Absent that flag, assume classic: it
 * works everywhere, where a declarative payload to an older client is a silent failure.
 *
 * `shared/` compiles into the server, the client *and* the service worker projects, so a change
 * here breaks whichever side has not caught up.
 */

/** Where the push routes are mounted. Everything below is derived from it. */
export const PUSH_BASE_PATH = "/api/push";

/** The document carrying the VAPID public key and the payload budget. */
export const PUSH_CONFIG_PATH = `${PUSH_BASE_PATH}/config`;

/** Where the client posts its `PushSubscription`. */
export const PUSH_SUBSCRIPTIONS_PATH = `${PUSH_BASE_PATH}/subscriptions`;

export const PUSH_TRANSPORTS = ["declarative", "classic"] as const;
export type PushTransport = (typeof PUSH_TRANSPORTS)[number];

export function isPushTransport(value: unknown): value is PushTransport {
	return typeof value === "string" && (PUSH_TRANSPORTS as readonly string[]).includes(value);
}

/**
 * The magic opt-in integer that marks a decrypted payload as a declarative push message. Named
 * for RFC 8030; a user agent opportunistically parses every incoming message looking for it, so
 * a classic payload must never carry it.
 */
export const DECLARATIVE_WEB_PUSH_MAGIC = 8030;

/**
 * Plaintext budget in bytes.
 *
 * RFC 8291 caps the encrypted record at 4096 bytes and the aes128gcm framing — 16-byte salt,
 * 4-byte record size, 1-byte key-id length, 65-byte ephemeral public key, 16-byte auth tag and
 * a 1-byte padding delimiter — eats 103 of them. 3500 leaves room to spare rather than
 * discovering the ceiling as a `400` from Apple.
 */
export const PUSH_PAYLOAD_MAX_BYTES = 3500;

/**
 * How long the push service retains an undelivered message.
 *
 * **Must be positive**, or Apple rejects the request with `BadTtl`. A tunable in the spec's
 * configuration table; it becomes a settings row when the settings screen lands, and until then
 * this constant is the single place it is written down.
 */
export const PUSH_TTL_SECONDS = 86_400;

/**
 * The manifest's scope, repeated here so the navigate check has something to assert against.
 * It is `/` and must never move — a push subscription keys to the scope, not merely the origin.
 */
export const MANIFEST_SCOPE = "/";

/** What a notification says, before it is dressed in either transport's clothing. */
export interface PushNotificationContent {
	/** Front-loaded identity: the Dynamic Island shows the title and the first few words only. */
	readonly title: string;
	readonly body: string;
	/** Absolute URL, same-origin and inside `MANIFEST_SCOPE`. See `resolveNavigateTarget`. */
	readonly navigate: string;
	/** BCP 47 tag. The app is `en-AU`; card names may be Japanese, so this is per-notification. */
	readonly lang?: string;
}

/**
 * **The app badge is deliberately absent.**
 *
 * Declarative Web Push carries an `app_badge` member and the badge is a real requirement — but
 * of a later ticket, and its JSON *type* could not be settled from a primary source here. The
 * Push API's member list does not enumerate it, and WebKit's own published example writes it as
 * the string `"1"` rather than the number the Badging API takes. Shipping a coin flip into the
 * one part of this system whose failures are permanent and invisible on the device is exactly
 * what the silent-push rule warns against, so the field is left for whoever can hold a handset
 * while they add it.
 */

/**
 * Declarative Web Push, per the Push API's declarative push message format.
 *
 * `web_push`, `notification.title` and `notification.navigate` are required; the rest of the
 * object is optional members of `NotificationOptions`.
 *
 * **`mutable` is deliberately absent and must stay absent.** Setting it true dispatches a `push`
 * event to the service worker carrying the proposed notification — which re-arms the 30-second
 * silent-push timer and forfeits the exemption that is the entire reason for choosing this
 * transport. There is nothing to gain: the payload already says everything the notification says.
 */
export interface DeclarativePushPayload {
	readonly web_push: typeof DECLARATIVE_WEB_PUSH_MAGIC;
	readonly notification: {
		readonly title: string;
		readonly body: string;
		readonly navigate: string;
		readonly lang?: string;
		readonly silent: false;
	};
}

/**
 * The classic payload: our own shape, read by our own worker, never seen by a user agent that
 * renders declaratively. Keys mirror `PushNotificationContent` so the worker's parser can accept
 * either shape without a second vocabulary.
 */
export interface ClassicPushPayload {
	readonly title: string;
	readonly body: string;
	readonly navigate: string;
	readonly lang?: string;
}

export class PushPayloadTooLargeError extends Error {
	readonly bytes: number;

	constructor(bytes: number) {
		super(`push payload is ${bytes} bytes, over the ${PUSH_PAYLOAD_MAX_BYTES}-byte budget`);
		this.name = "PushPayloadTooLargeError";
		this.bytes = bytes;
	}
}

/**
 * Build an absolute navigate target inside the app.
 *
 * The tap target has to be same-origin and inside the manifest scope or the notification opens
 * nothing. Throws rather than returning a broken URL: a notification that cannot be acted on has
 * spent the owner's attention for nothing.
 */
export function resolveNavigateTarget(origin: string, path: string): string {
	const base = new URL(origin);
	const target = new URL(path, base);

	if (target.origin !== base.origin) {
		throw new Error(
			`navigate target ${target.href} is not same-origin with ${base.origin}; the tap would ` +
				"leave the app",
		);
	}
	if (!target.pathname.startsWith(MANIFEST_SCOPE)) {
		throw new Error(
			`navigate target ${target.href} is outside the manifest scope ${MANIFEST_SCOPE}`,
		);
	}
	return target.href;
}

function assertDisplayable(content: PushNotificationContent): void {
	if (content.title.trim() === "") {
		throw new Error("push notification title is empty; a declarative message requires one");
	}
	if (content.navigate.trim() === "") {
		throw new Error("push notification navigate is empty; a declarative message requires one");
	}
}

export function buildDeclarativePayload(content: PushNotificationContent): DeclarativePushPayload {
	assertDisplayable(content);
	return {
		web_push: DECLARATIVE_WEB_PUSH_MAGIC,
		notification: {
			title: content.title,
			body: content.body,
			navigate: content.navigate,
			// `silent: false` is explicit: a silent declarative notification would display without
			// alerting, which is indistinguishable from the failure this transport exists to avoid.
			silent: false,
			...(content.lang === undefined ? {} : { lang: content.lang }),
		},
	};
}

export function buildClassicPayload(content: PushNotificationContent): ClassicPushPayload {
	assertDisplayable(content);
	return {
		title: content.title,
		body: content.body,
		navigate: content.navigate,
		...(content.lang === undefined ? {} : { lang: content.lang }),
	};
}

export interface SerialisedPush {
	readonly transport: PushTransport;
	/** The plaintext handed to RFC 8291 encryption. */
	readonly body: string;
	/** Its length in bytes, which is what the budget is denominated in — not characters. */
	readonly bytes: number;
}

/**
 * One shape, never both. The transport comes from the subscription record, so a device that
 * cannot render declaratively never receives a declarative payload and vice versa.
 */
export function serialisePushPayload(
	content: PushNotificationContent,
	transport: PushTransport,
): SerialisedPush {
	const payload =
		transport === "declarative" ? buildDeclarativePayload(content) : buildClassicPayload(content);
	const body = JSON.stringify(payload);
	// Byte length, not `body.length`: a Japanese card name is three bytes a character in UTF-8.
	const bytes = new TextEncoder().encode(body).length;

	if (bytes > PUSH_PAYLOAD_MAX_BYTES) {
		throw new PushPayloadTooLargeError(bytes);
	}
	return { transport, body, bytes };
}

/** `GET /api/push/config`. `vapidPublicKey` is null when the environment has not been set up. */
export interface PushConfigDocument {
	readonly vapidPublicKey: string | null;
	readonly ttlSeconds: number;
	readonly maxPayloadBytes: number;
}

/** `POST /api/push/subscriptions` — the browser's `PushSubscription`, plus the transport flag. */
export interface PushSubscriptionRequest {
	/** Client-generated, per the convention for client-authored rows. Optional; the server mints
	 * one when absent. Identity on the server is the endpoint, so a replay is idempotent either
	 * way. */
	readonly id?: string;
	readonly endpoint: string;
	readonly keys: { readonly p256dh: string; readonly auth: string };
	/** What the device can render. Absent means classic — the shape that works everywhere. */
	readonly transport?: PushTransport;
	/** UTC epoch ms, straight off `PushSubscription.expirationTime`. Null on iOS. */
	readonly expirationTime?: number | null;
	readonly userAgent?: string | null;
}

export interface PushSubscriptionDocument {
	readonly id: string;
	readonly transport: PushTransport;
	readonly createdAt: number;
	readonly updatedAt: number;
	/** UTC epoch ms of the last push this endpoint accepted, or null if none has been sent. */
	readonly lastSuccessAt: number | null;
}
