/// <reference lib="webworker" />

import { DECLARATIVE_WEB_PUSH_MAGIC, MANIFEST_SCOPE } from "../../shared/push.ts";

/**
 * The service worker's push handlers.
 *
 * **This module is the single most dangerous file in the repository, and the danger cannot be
 * observed while debugging.**
 *
 * Every push arms an independent 30-second timer on the device. If `showNotification()` has not
 * been called before it expires, that is a strike. Strikes accumulate on a counter that **never
 * decays and is never credited by a success**, and the **third revokes every push subscription
 * for the origin** — not the one subscription, all of them. The only route back to zero is a
 * full unsubscribe and re-subscribe, which costs a tap on the device. WebKit **suppresses
 * enforcement whenever a Web Inspector is attached**, so this failure cannot be reproduced in
 * development by design. It has to be right by construction.
 *
 * Hence the shape of `registerPushHandlers`, which is asserted by `tests/sw/push-handler.test.ts`
 * and must not be softened:
 *
 * - `showNotification()` is called **unconditionally** — it is the last statement of the
 *   listener, outside every `try`, and no branch can reach the end of the listener without it.
 * - It is called **from the payload**, synchronously. Nothing is awaited first.
 * - It is called **inside `waitUntil()`**, so the worker is not killed mid-display.
 * - **Nothing in this module fetches the origin.** Not before the call, not after it. The server
 *   is unreachable off-tailnet, and a notification that waits on it is a strike.
 *
 * The failure of the payload parse chooses *what* is displayed. It can never choose *whether*.
 *
 * Devices on iOS 18.4+ never run this handler at all: they receive Declarative Web Push, which
 * dispatches no `push` event and is exempt from the penalty. This is the fallback for
 * iOS 16.4–18.3.
 */

/** The minimum of `PushMessageData` this module uses. Keeps the parser testable with a literal. */
export interface PushPayloadReader {
	text(): string;
}

export interface PushNotificationView {
	readonly title: string;
	readonly options: NotificationOptions;
}

/**
 * What is shown when the payload cannot be read at all.
 *
 * It is deliberately vague rather than absent. A notification the owner does not fully
 * understand still leaves them able to open the app; a notification that never appears costs a
 * third of the origin's subscription lifetime.
 */
export const FALLBACK_NOTIFICATION: PushNotificationView = {
	title: "Gloom Watch",
	options: {
		body: "Something was listed. Open the app to see it.",
		data: { navigate: MANIFEST_SCOPE },
	},
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Read either payload shape into something displayable. Total by construction: every failure
 * path returns `FALLBACK_NOTIFICATION` rather than throwing.
 *
 * It accepts the declarative shape as well as our own, even though a declarative message never
 * reaches this handler on a device that understands it. If the client's transport detection is
 * ever wrong in that direction, the phone still shows the right notification instead of the
 * fallback — and gets there without a branch that could skip the display.
 */
export function readPushNotification(data: PushPayloadReader | null): PushNotificationView {
	if (data === null) return FALLBACK_NOTIFICATION;

	let parsed: unknown;
	try {
		parsed = JSON.parse(data.text());
	} catch {
		return FALLBACK_NOTIFICATION;
	}

	const envelope = asRecord(parsed);
	if (envelope === null) return FALLBACK_NOTIFICATION;

	const declarative =
		envelope.web_push === DECLARATIVE_WEB_PUSH_MAGIC ? asRecord(envelope.notification) : null;
	const source = declarative ?? envelope;

	const title = asText(source.title);
	if (title === undefined) return FALLBACK_NOTIFICATION;

	const navigate = asText(source.navigate) ?? MANIFEST_SCOPE;
	const lang = asText(source.lang);

	return {
		title,
		options: {
			body: asText(source.body) ?? "",
			// Carried through so `notificationclick` has a target without reading it back off the
			// Notification's own properties, several of which are not readable on iOS.
			data: { navigate },
			...(lang === undefined ? {} : { lang }),
			// No `icon` — iOS ignores it in favour of the manifest icon. No `tag` — it does not
			// coalesce on iOS. No `actions` — WebKit's payload parser has no such key.
		},
	};
}

/** Pull the navigate target back out of a notification without trusting iOS's property reads. */
function navigateTargetOf(notification: Notification): string {
	try {
		const data = asRecord(notification.data);
		return (data === null ? undefined : asText(data.navigate)) ?? MANIFEST_SCOPE;
	} catch {
		return MANIFEST_SCOPE;
	}
}

/**
 * Focus the app if it is already open, otherwise open it. The target is same-origin and inside
 * the manifest scope by the time it reaches here — the server refuses to send anything else.
 */
async function openNavigateTarget(scope: ServiceWorkerGlobalScope, target: string): Promise<void> {
	const url = new URL(target, scope.location.origin).href;
	const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });

	for (const client of windows) {
		try {
			await client.focus();
			// `navigate()` is not implemented everywhere; a focused window on the wrong screen is
			// still better than a second one.
			await client.navigate(url);
		} catch {
			// Focus succeeded or it did not; either way there is nothing further to try on this one.
		}
		return;
	}

	await scope.clients.openWindow(url);
}

/**
 * Wire the handlers onto a worker scope. Called from `client/sw.ts`; separated so the shape above
 * can be exercised by a test before a single real push is ever sent.
 */
export function registerPushHandlers(scope: ServiceWorkerGlobalScope): void {
	scope.addEventListener("push", (event) => {
		// Derive first. This is the only step that can fail, and `readPushNotification` is already
		// total — the `try` is belt and braces, and its `catch` chooses the content, never whether
		// there is any.
		let view: PushNotificationView;
		try {
			view = readPushNotification(event.data);
		} catch {
			view = FALLBACK_NOTIFICATION;
		}

		// Unconditional, from the payload, inside `waitUntil`, with nothing awaited before it and
		// no request to the origin anywhere in this file. Do not add one.
		event.waitUntil(scope.registration.showNotification(view.title, view.options));
	});

	scope.addEventListener("notificationclick", (event) => {
		event.notification.close();
		event.waitUntil(openNavigateTarget(scope, navigateTargetOf(event.notification)));
	});
}
