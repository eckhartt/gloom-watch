import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { BINDER_CACHE_CONTROL } from "../server/binder/http.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import type { BinderDocument } from "../shared/contract.ts";
import { BINDER_PATH } from "../shared/contract.ts";
import { EXPECTED_ORDER, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * Hono's handler against a real migrated SQLite database.
 *
 * The ticket's first criterion is a shape, not a body: *one request returns the whole binder
 * document; it is cacheable and unpaginated*. These assert all three halves of that — one
 * request, everything in it, and headers that let the phone and the service worker keep it.
 */
describe(`GET ${BINDER_PATH}`, () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	/**
	 * A clock that **moves**, because the one that did not hid a real defect.
	 *
	 * The ETag was originally taken over the whole response body, which carries `generatedAt`.
	 * Against a frozen clock every assertion passed; against a running server two consecutive
	 * requests produced different ETags, no `If-None-Match` ever matched, and the phone would
	 * have re-downloaded the entire binder on every revalidation.
	 */
	function app() {
		let clock = 1_800_000_000_000;
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => (clock += 1_000),
		});
	}

	it("returns the whole masterset in one response", async () => {
		const response = await app().request(BINDER_PATH);
		expect(response.status).toBe(200);

		const body = (await response.json()) as BinderDocument;
		expect(body.entries.map((entry) => entry.key)).toEqual(EXPECTED_ORDER);
	});

	it("is cacheable, and revalidates rather than refusing to be stored", async () => {
		// `no-cache` is not `no-store`. Health and the sync routes carry `no-store` because they
		// are server state read fresh every time; the binder is meant to be kept — it is what the
		// service worker serves when the tailnet is not there.
		const response = await app().request(BINDER_PATH);
		expect(response.headers.get("cache-control")).toBe(BINDER_CACHE_CONTROL);
		expect(BINDER_CACHE_CONTROL).not.toContain("no-store");
		expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
	});

	it("answers 304 to a matching If-None-Match, so an unchanged binder costs nothing", async () => {
		const server = app();
		const first = await server.request(BINDER_PATH);
		const etag = first.headers.get("etag") ?? "";

		const second = await server.request(BINDER_PATH, { headers: { "if-none-match": etag } });
		expect(second.status).toBe(304);
		expect(second.headers.get("etag")).toBe(etag);
		expect(await second.text()).toBe("");
	});

	it("keeps the same ETag as time passes, since only the corpus can change the binder", async () => {
		// The regression: `generatedAt` was inside the hash, so the ETag was different on every
		// request and revalidation always cost the whole document.
		const server = app();
		const before = (await server.request(BINDER_PATH)).headers.get("etag");
		const later = (await server.request(BINDER_PATH)).headers.get("etag");
		const laterStill = (await server.request(BINDER_PATH)).headers.get("etag");

		expect(later).toBe(before);
		expect(laterStill).toBe(before);
		// And the bodies really did carry different build stamps, so the clock was moving.
		const one = (await server.request(BINDER_PATH)).clone();
		const two = await server.request(BINDER_PATH);
		expect(((await one.json()) as BinderDocument).generatedAt).not.toBe(
			((await two.json()) as BinderDocument).generatedAt,
		);
	});

	it("changes its ETag when the corpus changes", async () => {
		const server = app();
		const before = (await server.request(BINDER_PATH)).headers.get("etag");

		temp.handle.sqlite.exec("update corpus_cards set name = 'Vileplume ex' where local_id = '45'");

		const after = (await server.request(BINDER_PATH)).headers.get("etag");
		expect(after).not.toBe(before);
	});

	it("takes no parameters — a filtered or paged URL is the same whole document", async () => {
		// Deliberate. The service worker caches by URL, so a URL that varied by filter would
		// leave it holding one arbitrary slice of the masterset instead of the masterset, and
		// offline browsing would work only for whatever the owner last looked at.
		const response = await app().request(`${BINDER_PATH}?set=base2&page=2`);
		expect(response.status).toBe(200);

		const body = (await response.json()) as BinderDocument;
		expect(body.entries).toHaveLength(EXPECTED_ORDER.length);
	});

	it("answers an empty corpus with an empty document rather than an error", async () => {
		const empty = createTempDatabase();
		try {
			const response = await createApp({
				handle: empty.handle,
				clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
				now: () => 1,
			}).request(BINDER_PATH);

			expect(response.status).toBe(200);
			expect(((await response.json()) as BinderDocument).entries).toEqual([]);
		} finally {
			empty.dispose();
		}
	});
});
