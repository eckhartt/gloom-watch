import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PushPlatformFacts } from "../../client/push.ts";
import { describePushEnvironment } from "../../client/push.ts";

/**
 * The runtime capability gate, and the guard on the one-shot permission prompt.
 *
 * Both matter for the same reason: iOS answers the system prompt once, a denial is effectively
 * permanent, and the app gets no second chance to explain itself. Raising the prompt from
 * anything but a tap — or raising it on a device that could never have subscribed anyway — spends
 * that one chance for nothing.
 */

const INSTALLED_WEB_APP: PushPlatformFacts = {
	standalone: true,
	serviceWorker: true,
	pushManager: true,
	notification: { permission: "default", declarative: true },
};

describe("the runtime capability check", () => {
	it("is ready only when every precondition holds", () => {
		expect(describePushEnvironment(INSTALLED_WEB_APP).ready).toBe(true);
	});

	it.each([
		["opened in Safari rather than from the icon", { standalone: false }],
		["no service worker", { serviceWorker: false }],
		["no Push API", { pushManager: false }],
		["no Notification global", { notification: null }],
	])("is not ready with %s", (_label, missing) => {
		expect(describePushEnvironment({ ...INSTALLED_WEB_APP, ...missing }).ready).toBe(false);
	});

	it("requires the Push API even in standalone display mode", () => {
		// iOS 26 lets "Open as Web App" be turned off at install time, producing a Home Screen icon
		// that opens in Safari — a bookmark with no Push API. Checking the display mode alone would
		// call that ready and then fail at subscribe() with nothing the owner could act on.
		const bookmark = describePushEnvironment({
			...INSTALLED_WEB_APP,
			pushManager: false,
			notification: null,
		});
		expect(bookmark.standalone).toBe(true);
		expect(bookmark.ready).toBe(false);
	});

	it("reports an absent Notification global as unavailable, not as denied", () => {
		// Denied means the owner said no and Settings is the only way back. Unavailable means the
		// install is wrong. Conflating them sends the owner to the wrong place.
		expect(describePushEnvironment({ ...INSTALLED_WEB_APP, notification: null }).permission).toBe(
			"unavailable",
		);
	});

	it("reports declarative when the probe finds it, and classic when it does not", () => {
		// The probe is `"navigate" in Notification.prototype`, and it discriminates rather than
		// defaults: MDN records `api.Notification.navigate` as Safari 18.4, mirrored on Safari iOS,
		// and `false` on both Chrome and Firefox — while WebKit shipped Declarative Web Push on iOS
		// and iPadOS 18.4. Same version, same platforms, and no engine has one without the other.
		//
		// It matters which way this goes. Answering `classic` on an iOS 18.4+ handset puts that
		// device back on the transport the silent-push penalty applies to, and does it without an
		// error anywhere — which is why the value is shown on screen, stored on the subscription
		// and written into every echo-log row.
		expect(
			describePushEnvironment({
				...INSTALLED_WEB_APP,
				notification: { permission: "granted", declarative: true },
			}).transport,
		).toBe("declarative");

		expect(
			describePushEnvironment({
				...INSTALLED_WEB_APP,
				notification: { permission: "granted", declarative: false },
			}).transport,
		).toBe("classic");
	});

	it("falls back to classic when there is no Notification global to probe at all", () => {
		expect(describePushEnvironment({ ...INSTALLED_WEB_APP, notification: null }).transport).toBe(
			"classic",
		);
	});
});

describe("the one-shot permission prompt", () => {
	const stripComments = (source: string) =>
		source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

	const push = stripComments(
		readFileSync(new URL("../../client/push.ts", import.meta.url), "utf8"),
	);
	const ui = stripComments(
		readFileSync(new URL("../../client/notifications.tsx", import.meta.url), "utf8"),
	);

	it("asks for permission in exactly one place", () => {
		expect(push.match(/requestPermission\(/g) ?? []).toHaveLength(1);
		expect(ui).not.toMatch(/requestPermission/);
	});

	it("never raises the prompt from an effect — only a tap reaches enablePush", () => {
		// A source assertion, like the service worker's. The failure it guards against is
		// unrecoverable without a trip through Settings, and it is one careless `useEffect` away.
		const effects = ui.match(/useEffect\([\s\S]*?\},\s*\[\]\)/g) ?? [];
		expect(effects.length).toBeGreaterThan(0);
		for (const effect of effects) {
			expect(effect).not.toMatch(/enablePush/);
		}
		expect(ui).toMatch(/onClick=\{onEnable\}/);
	});

	it("keeps the re-enable button outside every conditional branch", () => {
		// iOS drops subscriptions with no event to the page, so there is no state in which the app
		// could know the button is needed. It is rendered unconditionally and disabled when the
		// device could not subscribe anyway.
		expect(ui).toMatch(/Re-enable notifications/);
		const afterConditionals = ui.slice(ui.lastIndexOf("{showSoftAsk ?"));
		expect(afterConditionals).toMatch(/onClick=\{onEnable\}[\s\S]*Re-enable notifications/);
	});
});
