/**
 * Which requests the service worker caches, and under which name.
 *
 * The matchers live here rather than inline in `client/sw.ts` so they can be checked without a
 * browser. The one that has actually bitten is the corpus image path: `card_key` is
 * `{language}:{card_id}` and carries a **colon**, so it arrives percent-encoded as
 * `en%3Abase2-44`. A matcher written against the characters somebody expected in an identifier
 * would match nothing, the images would never be cached, and the binder would look perfectly
 * fine right up until the phone left the tailnet.
 */

/** Corpus card images. Content-addressed by upstream's hash and effectively immutable. */
export const CORPUS_IMAGE_CACHE = "gloom-watch-corpus-images";

/** The binder document. One entry, replaced whole. */
export const BINDER_DOCUMENT_CACHE = "gloom-watch-binder";

/**
 * 497 cards today and no upper bound on a masterset, so the ceiling is generous rather than
 * tight. It exists for the `purgeOnQuotaError` behaviour it comes with more than for the count:
 * iOS evicts a whole origin's storage without warning, and a strategy that throws on a full
 * cache would fail the image rather than simply not storing it.
 */
export const CORPUS_IMAGE_CACHE_MAX_ENTRIES = 2000;

/** A year. The URL is stable and the ETag is upstream's own content hash, so age is not staleness. */
export const CORPUS_IMAGE_CACHE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * `/api/corpus/cards/{path-encoded card key}/image`.
 *
 * Matched on the path rather than on `request.destination === "image"`, because the sheet and
 * the grid could reasonably fetch the same bytes some other way — a warm-the-cache button is a
 * stated v1 feature — and a matcher that only recognises `<img>` would quietly stop covering it.
 */
export function isCorpusImagePath(pathname: string): boolean {
	return /^\/api\/corpus\/cards\/[^/]+\/image$/.test(pathname);
}

/** `/api/binder` — the one unpaginated document. Exact: there are no query parameters. */
export function isBinderDocumentPath(pathname: string): boolean {
	return pathname === "/api/binder";
}

/**
 * Navigations the service worker must **not** answer with the app shell.
 *
 * Workbox's `NavigationRoute` serves precached `index.html` for every navigation except this
 * list. `/unlock` is a real HTML document from the server. Intercepting it hands TanStack
 * Router a URL it has no route for, and the owner sees "Not Found" instead of the gate.
 */
export const APP_SHELL_NAVIGATION_DENYLIST: readonly RegExp[] = [/^\/api\//, /^\/unlock(?:\/|$)/];

export function isAppShellNavigation(pathname: string): boolean {
	return !APP_SHELL_NAVIGATION_DENYLIST.some((pattern) => pattern.test(pathname));
}
