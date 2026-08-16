import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	FALLBACK_NOTIFICATION,
	readPushNotification,
	registerPushHandlers,
} from "../../client/sw/push-handler.ts";
import { buildClassicPayload, buildDeclarativePayload, MANIFEST_SCOPE } from "../../shared/push.ts";

/**
 * The guard on the silent-push rule.
 *
 * Three pushes that fail to show a notification revoke **every** subscription for the origin, the
 * counter never decays, and WebKit suppresses enforcement whenever an inspector is attached — so
 * the failure cannot be reproduced on the device by design. These assertions are the only place
 * the rule is checkable at all, and they were written before a single real push was sent.
 *
 * The load-bearing ones are in "the shape of the push handler": `showNotification()` is called
 * once, synchronously, for every payload including a broken one, and the promise it returns is
 * exactly what went to `waitUntil()`.
 */

interface RecordedShow {
	readonly title: string;
	readonly options: NotificationOptions | undefined;
}

function fakeScope() {
	const listeners = new Map<string, (event: never) => void>();
	const shown: RecordedShow[] = [];
	const waited: unknown[] = [];
	const opened: string[] = [];
	const showNotification = vi.fn((title: string, options?: NotificationOptions) => {
		shown.push({ title, options });
		return Promise.resolve();
	});

	const scope = {
		addEventListener(type: string, listener: (event: never) => void) {
			listeners.set(type, listener);
		},
		location: { origin: "https://htpc.tail594f35.ts.net" },
		registration: { showNotification },
		clients: {
			matchAll: () => Promise.resolve([]),
			openWindow: (url: string) => {
				opened.push(url);
				return Promise.resolve(null);
			},
		},
	} as unknown as ServiceWorkerGlobalScope;

	registerPushHandlers(scope);

	return {
		shown,
		waited,
		opened,
		showNotification,
		/** Dispatch a `push` event carrying `body`, or `null` for a payloadless push. */
		push(body: string | null) {
			const listener = listeners.get("push");
			if (listener === undefined) throw new Error("no push listener was registered");
			const event = {
				data: body === null ? null : { text: () => body },
				waitUntil(promise: unknown) {
					waited.push(promise);
				},
			};
			(listener as (event: unknown) => void)(event);
		},
		click(data: unknown) {
			const listener = listeners.get("notificationclick");
			if (listener === undefined) throw new Error("no notificationclick listener");
			const closed: boolean[] = [];
			const event = {
				notification: {
					data,
					close: () => {
						closed.push(true);
					},
				},
				waitUntil(promise: unknown) {
					waited.push(promise);
				},
			};
			(listener as (event: unknown) => void)(event);
			return { closed };
		},
	};
}

const content = {
	title: "Gloom — Jungle JA holo",
	body: "¥4,200 — ungraded — auction 3d",
	navigate: "https://htpc.tail594f35.ts.net/listings/abc123",
	lang: "ja",
};

describe("the shape of the push handler", () => {
	it("calls showNotification exactly once, synchronously, inside waitUntil", () => {
		const scope = fakeScope();
		scope.push(JSON.stringify(buildClassicPayload(content)));

		// Synchronously: by the time the listener has returned the call has already happened. A
		// handler that awaited a fetch first would fail here, which is the whole point.
		expect(scope.showNotification).toHaveBeenCalledTimes(1);
		expect(scope.waited).toHaveLength(1);
		// The promise handed to waitUntil is the one showNotification returned — not a wrapper that
		// could resolve before the notification is displayed.
		expect(scope.waited[0]).toBe(scope.showNotification.mock.results[0]?.value);
	});

	it("shows the payload's own title and body", () => {
		const scope = fakeScope();
		scope.push(JSON.stringify(buildClassicPayload(content)));

		expect(scope.shown[0]?.title).toBe(content.title);
		expect(scope.shown[0]?.options?.body).toBe(content.body);
		expect(scope.shown[0]?.options?.lang).toBe("ja");
		expect(scope.shown[0]?.options?.data).toEqual({ navigate: content.navigate });
	});

	it.each([
		["a payloadless push", null],
		["a payload that is not JSON", "}{ not json"],
		["a JSON payload that is not an object", "42"],
		["an object with no title", JSON.stringify({ body: "no title here" })],
		["an object whose title is empty", JSON.stringify({ title: "", body: "b" })],
		["an object whose title is a number", JSON.stringify({ title: 7 })],
		["a null payload body", JSON.stringify(null)],
	])("still shows a notification for %s", (_label, body) => {
		const scope = fakeScope();
		scope.push(body);

		expect(scope.showNotification).toHaveBeenCalledTimes(1);
		expect(scope.shown[0]?.title).toBe(FALLBACK_NOTIFICATION.title);
		expect(scope.waited).toHaveLength(1);
	});

	it("shows a declarative payload too, so a mis-detected transport still displays", () => {
		// The server never sends declarative to a classic subscription. If the client's transport
		// detection is ever wrong in that direction the phone should still buzz correctly rather
		// than fall back — and get there without a branch that could skip the display.
		const scope = fakeScope();
		scope.push(JSON.stringify(buildDeclarativePayload(content)));

		expect(scope.shown[0]?.title).toBe(content.title);
		expect(scope.shown[0]?.options?.body).toBe(content.body);
	});

	it("ignores a declarative envelope whose magic number is wrong", () => {
		const scope = fakeScope();
		scope.push(JSON.stringify({ web_push: 1234, notification: { title: "nope" } }));

		expect(scope.shown[0]?.title).toBe(FALLBACK_NOTIFICATION.title);
	});

	it("sets no icon, tag or actions — iOS ignores the first two and has no key for the third", () => {
		const scope = fakeScope();
		scope.push(JSON.stringify(buildClassicPayload(content)));

		const options = scope.shown[0]?.options as Record<string, unknown>;
		expect(options).not.toHaveProperty("icon");
		expect(options).not.toHaveProperty("tag");
		expect(options).not.toHaveProperty("actions");
	});
});

describe("the push handler never touches the network", () => {
	// A source assertion rather than a behavioural one, deliberately. The danger is a future edit
	// that adds a lookup before `showNotification()`; the failure it causes is invisible on the
	// device and permanent after three occurrences, so it is worth catching in the diff. Comments
	// are stripped first — this file's prose talks about `fetch` and `showNotification` at length.
	const code = readFileSync(new URL("../../client/sw/push-handler.ts", import.meta.url), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");

	it("contains no call to fetch, caches or XMLHttpRequest", () => {
		expect(code).not.toMatch(/\bfetch\s*\(/);
		expect(code).not.toMatch(/\bcaches\b/);
		expect(code).not.toMatch(/XMLHttpRequest/);
		expect(code).not.toMatch(/importScripts/);
	});

	it("calls showNotification exactly once in the whole module", () => {
		expect(code.match(/showNotification\(/g) ?? []).toHaveLength(1);
	});
});

describe("reading a payload", () => {
	it("falls back to the manifest scope when the payload names no navigate target", () => {
		const view = readPushNotification({ text: () => JSON.stringify({ title: "t" }) });
		expect(view.options.data).toEqual({ navigate: MANIFEST_SCOPE });
	});

	it("never throws, whatever text() returns", () => {
		expect(() =>
			readPushNotification({
				text() {
					throw new Error("PushMessageData exploded");
				},
			}),
		).not.toThrow();
	});
});

describe("the notification tap", () => {
	it("closes the notification and opens the payload's navigate target", async () => {
		const scope = fakeScope();
		const { closed } = scope.click({ navigate: "/listings/abc123" });
		await Promise.all(scope.waited);

		expect(closed).toEqual([true]);
		expect(scope.opened).toEqual(["https://htpc.tail594f35.ts.net/listings/abc123"]);
	});

	it("falls back to the app root when the notification's data cannot be read", async () => {
		const scope = fakeScope();
		scope.click(undefined);
		await Promise.all(scope.waited);

		expect(scope.opened).toEqual(["https://htpc.tail594f35.ts.net/"]);
	});
});
