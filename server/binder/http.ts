/**
 * The binder's HTTP surface: one route, one document, no parameters.
 *
 * There is deliberately nothing to page and nothing to filter here. The spec fixes the binder as
 * **one cacheable request** because that is what lets the phone browse and filter with no
 * connection, and a `?page=` or a `?set=` would quietly take that away — the service worker
 * would hold one arbitrary slice instead of the masterset. Filtering is the client's job over
 * the whole document, in a later ticket.
 */

import { createHash } from "node:crypto";
import { Hono } from "hono";
import { BINDER_PATH } from "../../shared/contract.ts";
import type { GloomDatabase } from "../db/client.ts";
import { buildBinderDocument } from "./document.ts";

export interface BinderRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

/**
 * `no-cache` means **revalidate, not do not store** — the opposite of `no-store`, which is what
 * health and the sync routes carry.
 *
 * The document changes when the corpus is synced and when a copy is recorded, and neither has a
 * schedule, so guessing a freshness lifetime would either serve a stale binder after a sync or
 * throw away a perfectly good 200 KB every minute. Revalidating against the ETag costs one round
 * trip and a ~200-byte `304` when nothing moved. Offline it costs nothing at all: the service
 * worker serves its stored copy and never asks.
 *
 * `private` because this is one person's collection, and there is a Tailscale proxy in front.
 */
export const BINDER_CACHE_CONTROL = "private, no-cache";

/**
 * The ETag is a hash of the **entries**, not of the whole response and not of the corpus's
 * last-synced timestamp.
 *
 * Not the whole response, because the document carries `generatedAt` — the instant the server
 * built it — which is different on every request by construction. Hashing it would produce a
 * fresh ETag every time, no `If-None-Match` would ever match, and the phone would re-download
 * ~290 KB on every revalidation. Found by watching two consecutive requests to a running server
 * disagree; `tests/binder-http.test.ts` pins it with a clock that moves.
 *
 * Not a timestamp, because a timestamp would be wrong twice: recording a copy changes the
 * document without touching the corpus, and a failed sync touches the corpus without changing
 * the document. What the client is asking is *has the masterset changed*, and the entries are
 * the answer to exactly that question.
 *
 * A `304` therefore leaves the client holding a body whose `generatedAt` is older than now,
 * which is correct: that is genuinely when the binder it is holding was built.
 */
function etagFor(entriesJson: string): string {
	return `"${createHash("sha256").update(entriesJson).digest("hex").slice(0, 32)}"`;
}

export function createBinderRoutes(deps: BinderRouteDeps): Hono {
	const routes = new Hono();

	routes.get(BINDER_PATH, (c) => {
		const document = buildBinderDocument({ db: deps.db, now: deps.now });
		const etag = etagFor(JSON.stringify(document.entries));

		c.header("ETag", etag);
		c.header("Cache-Control", BINDER_CACHE_CONTROL);

		if (c.req.header("if-none-match") === etag) {
			// Nothing serialised beyond the entries above, so an unchanged binder costs a hash of
			// what is already in memory rather than 290 KB on the wire.
			return c.body(null, 304);
		}

		c.header("Content-Type", "application/json; charset=UTF-8");
		return c.body(JSON.stringify(document));
	});

	return routes;
}
