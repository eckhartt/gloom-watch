/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import {
	BINDER_DOCUMENT_CACHE,
	CORPUS_IMAGE_CACHE,
	CORPUS_IMAGE_CACHE_MAX_AGE_SECONDS,
	CORPUS_IMAGE_CACHE_MAX_ENTRIES,
	isBinderDocumentPath,
	isCorpusImagePath,
} from "./sw/caching.ts";
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
 *
 * Two runtime caches sit alongside the precache and are chosen in opposite directions — corpus
 * images `CacheFirst` because they never change, the binder document `NetworkFirst` because it
 * changes whenever the owner does anything. Both are below.
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

/**
 * Corpus card images: **`CacheFirst`**, and the only strategy that makes sense for them.
 *
 * The bytes behind one of these URLs never change. The image is fetched from upstream only when
 * TCGdex's own hash manifest moves, the response carries that hash as its ETag and a year of
 * `immutable`, and there are ~380 of them totalling 26 MiB. Going to the network first would
 * spend a round trip per cell to be told nothing changed, on a phone, over a tailnet — and
 * offline it would spend a timeout instead. Cached first, the binder paints from local storage
 * and the network is touched once per image for the life of the install.
 *
 * This is what "browse the masterset at a card fair" actually depends on.
 */
registerRoute(
	({ url }) => isCorpusImagePath(url.pathname),
	new CacheFirst({
		cacheName: CORPUS_IMAGE_CACHE,
		plugins: [
			new ExpirationPlugin({
				maxEntries: CORPUS_IMAGE_CACHE_MAX_ENTRIES,
				maxAgeSeconds: CORPUS_IMAGE_CACHE_MAX_AGE_SECONDS,
				// iOS evicts an origin's storage without notice. Without this a full cache throws
				// out of the strategy and the image fails to render rather than merely not being
				// stored.
				purgeOnQuotaError: true,
			}),
		],
	}),
);

/**
 * The binder document: **`NetworkFirst`**, which is the opposite trade and deliberately so.
 *
 * It is one request that carries the whole masterset and its ownership state, and it changes
 * whenever the corpus is synced or a copy is recorded. Serving it from the cache first would
 * show the owner a binder that disagrees with what they just did. Going to the network first and
 * falling back to the last good copy means the binder is current when there is a tailnet and
 * still browsable when there is not — which is the whole reason the spec insists this is one
 * cacheable document rather than a paged API.
 *
 * The timeout matters: a phone with a dead tailnet resolves DNS and then hangs, and five seconds
 * of a blank grid is worse than a slightly stale one.
 */
registerRoute(
	({ url }) => isBinderDocumentPath(url.pathname),
	new NetworkFirst({ cacheName: BINDER_DOCUMENT_CACHE, networkTimeoutSeconds: 5 }),
);

// Registered last, but nothing above it can defer or intercept a `push` event — the routes are
// `fetch` handlers and the precache is already warm by then.
registerPushHandlers(self);
