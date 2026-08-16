/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { registerPushHandlers } from "./sw/push-handler.ts";

/**
 * Hand-authored service worker, built in `injectManifest` mode.
 *
 * `generateSW` was rejected outright: Workbox's generated worker cannot host a custom `push`
 * handler, and this is where that handler lives. It calls `showNotification()` **unconditionally,
 * from the encrypted payload, inside `waitUntil()`** and **never after a fetch to the origin** —
 * three silent-push failures revoke every subscription for the origin, the counter never decays,
 * and the only route back is a full unsubscribe and re-subscribe. The shape that guarantees it is
 * in `client/sw/push-handler.ts` and is asserted by `tests/sw/push-handler.test.ts`.
 *
 * The registration scope is `/` and must never move: push subscriptions key to the scope, not
 * merely to the origin.
 */

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// `registerType: 'autoUpdate'` — take over immediately rather than waiting for every tab to
// close. On a Home Screen web app there may never be a moment when none is open.
self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// One app shell for every navigation, matching the server's SPA fallback. The API is excluded:
// health is server state and must never be answered from a cache.
registerRoute(
	new NavigationRoute(createHandlerBoundToURL("index.html"), {
		denylist: [/^\/api\//],
	}),
);

// Registered last, but nothing above it can defer or intercept a `push` event — the routes are
// `fetch` handlers and the precache is already warm by then.
registerPushHandlers(self);
