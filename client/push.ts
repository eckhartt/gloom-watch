import type {
	PushConfigDocument,
	PushSubscriptionDocument,
	PushTransport,
} from "../shared/push.ts";
import { PUSH_CONFIG_PATH, PUSH_SUBSCRIPTIONS_PATH } from "../shared/push.ts";
import { ApiError } from "./api.ts";

/**
 * Everything the page does about push: work out whether this device can receive one at all, and
 * — only ever from a user gesture — ask for permission and register the subscription.
 *
 * Three iOS facts shape all of it:
 *
 * - **`Notification` does not exist outside an installed web app.** Referencing the global throws
 *   `ReferenceError`, so every access here is guarded rather than feature-detected in the usual
 *   `if (window.Notification)` way — which is itself the throwing expression on some versions.
 * - **iOS 26 lets the user turn "Open as Web App" off**, producing a Home Screen bookmark with no
 *   Push API. Standalone display mode alone does not settle it; both checks are needed.
 * - **The system permission prompt can be answered once.** A denial is effectively permanent and
 *   costs a trip through Settings to undo, so the prompt is only ever raised after the app has
 *   explained itself and the owner has tapped to say yes.
 */

export interface PushEnvironment {
	/** The manifest declares `display: standalone`; this is whether iOS honoured it. */
	readonly standalone: boolean;
	readonly serviceWorkerSupported: boolean;
	readonly pushSupported: boolean;
	readonly notificationSupported: boolean;
	/** What payload shape this device can render. See `detectTransport`. */
	readonly transport: PushTransport;
	/** `unavailable` when the `Notification` global is absent, which is not the same as denied. */
	readonly permission: NotificationPermission | "unavailable";
	/** Every precondition met. False here means the notifications UI explains why rather than asks. */
	readonly ready: boolean;
}

function hasNotificationGlobal(): boolean {
	// `typeof` rather than `"Notification" in window`: on iOS outside an installed web app the
	// identifier is not merely absent, and `typeof` is the one form that cannot throw.
	return typeof Notification !== "undefined";
}

function isStandalone(): boolean {
	if (typeof window === "undefined") return false;
	const displayModes = ["standalone", "fullscreen", "minimal-ui"];
	if (
		typeof window.matchMedia === "function" &&
		displayModes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
	) {
		return true;
	}
	// Safari's own flag, which predates `display-mode` and is still what older iOS sets.
	return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Which transport this device can render.
 *
 * **This is an inference, not something either specification defines.** The Push API's
 * declarative message format has no client-facing capability flag at all — a user agent simply
 * parses incoming messages opportunistically. What is observable is that `navigate` arrived on
 * `Notification` alongside Declarative Web Push, so its presence stands in for support.
 *
 * Wrong in the safe direction it costs one device the silent-push exemption and nothing else,
 * because the classic path works everywhere. Wrong the other way, the worker's parser reads a
 * declarative payload too, so the notification still displays.
 */
export function detectTransport(): PushTransport {
	if (!hasNotificationGlobal()) return "classic";
	return "navigate" in Notification.prototype ? "declarative" : "classic";
}

export function readPushEnvironment(): PushEnvironment {
	const standalone = isStandalone();
	const serviceWorkerSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
	const pushSupported = typeof window !== "undefined" && "PushManager" in window;
	const notificationSupported = hasNotificationGlobal();

	return {
		standalone,
		serviceWorkerSupported,
		pushSupported,
		notificationSupported,
		transport: detectTransport(),
		permission: notificationSupported ? Notification.permission : "unavailable",
		ready: standalone && serviceWorkerSupported && pushSupported && notificationSupported,
	};
}

export async function fetchPushConfig(signal?: AbortSignal): Promise<PushConfigDocument> {
	const response = await fetch(PUSH_CONFIG_PATH, {
		headers: { accept: "application/json" },
		...(signal ? { signal } : {}),
	});
	if (!response.ok) {
		throw new ApiError(response.status, `GET ${PUSH_CONFIG_PATH} responded ${response.status}`);
	}
	return (await response.json()) as PushConfigDocument;
}

/** base64url to bytes. `applicationServerKey` takes a BufferSource on every engine. */
function decodeBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
	const existing = subscription.options?.applicationServerKey;
	// Not every engine exposes it. Absent is not a mismatch — assume it matches rather than
	// unsubscribing a working subscription on no evidence.
	if (existing === null || existing === undefined) return true;

	const bytes = new Uint8Array(existing);
	return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

export type EnablePushFailure =
	| "not-standalone"
	| "no-push-api"
	| "not-configured"
	| "permission-denied"
	| "permission-dismissed"
	| "subscribe-failed";

export type EnablePushResult =
	| { readonly ok: true; readonly subscription: PushSubscriptionDocument }
	| { readonly ok: false; readonly reason: EnablePushFailure; readonly detail?: string };

/**
 * The whole flow: permission, subscribe, register.
 *
 * **Call this only from a user gesture.** iOS requires one for `Notification.requestPermission()`
 * and — unlike other engines — for `pushManager.subscribe()` as well, *even when permission has
 * already been granted*. That second requirement is why the re-enable button has to be a button
 * and cannot be a `useEffect`.
 *
 * Safe to call repeatedly. An existing subscription is reused, and the server keys on the
 * endpoint, so a replay yields one row.
 */
export async function enablePush(): Promise<EnablePushResult> {
	const environment = readPushEnvironment();
	if (!environment.standalone) return { ok: false, reason: "not-standalone" };
	if (!environment.pushSupported || !environment.serviceWorkerSupported) {
		return { ok: false, reason: "no-push-api" };
	}
	if (!environment.notificationSupported) return { ok: false, reason: "no-push-api" };

	if (Notification.permission === "denied") return { ok: false, reason: "permission-denied" };
	if (Notification.permission === "default") {
		const granted = await Notification.requestPermission();
		if (granted === "denied") return { ok: false, reason: "permission-denied" };
		if (granted !== "granted") return { ok: false, reason: "permission-dismissed" };
	}

	const config = await fetchPushConfig();
	if (config.vapidPublicKey === null) return { ok: false, reason: "not-configured" };
	const applicationServerKey = decodeBase64Url(config.vapidPublicKey);

	const registration = await navigator.serviceWorker.ready;

	let subscription = await registration.pushManager.getSubscription();
	if (subscription !== null && !sameApplicationServerKey(subscription, applicationServerKey)) {
		// The server's key has changed under a live subscription. Every send would come back
		// `VapidPkHashMismatch`; drop it and take a new one while there is a gesture to spend.
		await subscription.unsubscribe();
		subscription = null;
	}

	if (subscription === null) {
		try {
			subscription = await registration.pushManager.subscribe({
				// Mandatory on every engine, and honest here: this app only ever sends visible pushes.
				userVisibleOnly: true,
				applicationServerKey: applicationServerKey as BufferSource,
			});
		} catch (cause) {
			return { ok: false, reason: "subscribe-failed", detail: (cause as Error).message };
		}
	}

	return { ok: true, subscription: await registerSubscription(subscription) };
}

async function registerSubscription(
	subscription: PushSubscription,
): Promise<PushSubscriptionDocument> {
	const raw = subscription.toJSON();
	const keys = raw.keys ?? {};

	const response = await fetch(PUSH_SUBSCRIPTIONS_PATH, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify({
			// Client-generated, per the convention for rows the client authors. The server keys on
			// the endpoint regardless, so a replay is idempotent either way.
			id: crypto.randomUUID(),
			endpoint: subscription.endpoint,
			keys: { p256dh: keys.p256dh, auth: keys.auth },
			transport: detectTransport(),
			expirationTime: subscription.expirationTime,
			userAgent: navigator.userAgent,
		}),
	});

	if (!response.ok) {
		throw new ApiError(
			response.status,
			`POST ${PUSH_SUBSCRIPTIONS_PATH} responded ${response.status}`,
		);
	}
	return (await response.json()) as PushSubscriptionDocument;
}
