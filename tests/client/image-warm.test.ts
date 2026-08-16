import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WarmProgress } from "../../client/binder/image-warm.ts";
import {
	imageWarmTargets,
	openCorpusImageCache,
	warmCorpusImages,
	warmSummary,
} from "../../client/binder/image-warm.ts";
import { CORPUS_IMAGE_CACHE, isCorpusImagePath } from "../../client/sw/caching.ts";
import type { BinderEntry } from "../../shared/contract.ts";

/**
 * The bulk image warm.
 *
 * Four of its properties are claims that fail quietly, and each has a test here:
 *
 * - **It writes where the service worker reads.** A warm that stored 26 MiB under a URL the
 *   `CacheFirst` route does not match works perfectly on the tailnet and shows a blank binder at
 *   the card fair, which is the exact failure the image route's own matcher test exists for.
 * - **It is cheap when most images are already there.** iOS evicts Cache Storage without notice,
 *   so this is run repeatedly, and a version that re-downloaded everything each time would be
 *   unusable on the one connection it exists to get ahead of.
 * - **Progress is visible.** 26 MiB is minutes; a silent version reads as broken.
 * - **It never starts on its own.** Which is a property of the screen that hosts it, so it is
 *   asserted against that screen's source rather than hoped for.
 */

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

/** Cache Storage, small enough to reason about: a map of URL to the bytes stored under it. */
class FakeCache {
	readonly stored = new Map<string, ArrayBuffer>();

	async match(url: string): Promise<Response | undefined> {
		const held = this.stored.get(url);
		return held === undefined ? undefined : new Response(held);
	}

	async put(url: string, response: Response): Promise<void> {
		this.stored.set(url, await response.arrayBuffer());
	}

	asCache(): Cache {
		return this as unknown as Cache;
	}
}

function entry(overrides: Partial<BinderEntry> = {}): BinderEntry {
	return {
		key: "en:base2-44 endfynwn4n10gzq",
		cardKey: "en:base2-44",
		variantId: "endfynwn4n10gzq",
		language: "en",
		setId: "base2",
		setName: "Jungle",
		setReleaseDate: "1999-06-16",
		localId: "44",
		name: "Gloom",
		rarity: null,
		finish: "normal",
		subtype: null,
		stamps: [],
		foil: null,
		size: "standard",
		hasImage: true,
		missingUpstream: false,
		ownedCopies: 0,
		priority: null,
		...overrides,
	};
}

function imageResponse(size = 64): Response {
	return new Response(new ArrayBuffer(size), { headers: { "content-type": "image/webp" } });
}

describe("what the warm asks for", () => {
	it("asks once per card, not once per printing of it", () => {
		// Images attach to the card, so the four printings of Base Set Gloom are four binder entries
		// sharing one picture. Per entry this would be 817 requests for 382 images on the live
		// corpus — four times the traffic, for the same bytes, over a tailnet.
		const targets = imageWarmTargets([
			entry({ key: "a", cardKey: "en:base2-44", variantId: "one" }),
			entry({ key: "b", cardKey: "en:base2-44", variantId: "two" }),
			entry({ key: "c", cardKey: "en:base1-45" }),
		]);

		expect(targets).toHaveLength(2);
	});

	it("skips the cards upstream has no image for", () => {
		// 115 of the live corpus's 497 cards carry none. Fetching them would be 115 guaranteed 404s
		// reported to the owner as failures.
		expect(imageWarmTargets([entry({ hasImage: false })])).toEqual([]);
	});

	it("asks for the same path the grid asks for, colon and all", () => {
		// **The one that fails silently.** `card_key` carries a colon and arrives percent-encoded.
		// A warm that stored under any other spelling would fill the cache with entries the
		// `CacheFirst` route never matches — 26 MiB downloaded, and a blank binder off-tailnet.
		const targets = imageWarmTargets([entry({ cardKey: "ja:SV3-002" })]);

		expect(targets[0]).toBe("/api/corpus/cards/ja%3ASV3-002/image");
		expect(isCorpusImagePath(targets[0] ?? "")).toBe(true);
	});
});

describe("warming the cache", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("stores every image under the URL the service worker's route matches", async () => {
		const cache = new FakeCache();
		const urls = imageWarmTargets([
			entry({ cardKey: "en:base2-44" }),
			entry({ cardKey: "ja:SV3-002" }),
		]);

		await warmCorpusImages(urls, { cache: cache.asCache(), fetch: async () => imageResponse() });

		expect([...cache.stored.keys()].toSorted()).toEqual([...urls].toSorted());
		for (const url of cache.stored.keys()) expect(isCorpusImagePath(url)).toBe(true);
	});

	it("opens the cache the CacheFirst route writes to, by its name", async () => {
		// Two caches would mean a warmed image and a browsed image are two copies of 59 KB, and the
		// one the service worker serves from would be whichever the owner happened to fill.
		const open = vi.fn(async () => new FakeCache().asCache());
		vi.stubGlobal("caches", { open });

		await openCorpusImageCache();
		expect(open).toHaveBeenCalledWith(CORPUS_IMAGE_CACHE);
	});

	it("says so rather than throwing when Cache Storage is not available", async () => {
		// Plain HTTP to the box's LAN address is not a secure context, and that is a real way to
		// open this app while debugging.
		vi.stubGlobal("caches", undefined);
		await expect(openCorpusImageCache()).resolves.toBeNull();
	});

	it("costs no request at all for an image already in the cache", async () => {
		// iOS evicts storage without notice, so this is run again and again, and most of the time
		// most of it is already there. `CacheFirst` would answer these from the cache anyway — but
		// only after the page had opened a connection per image to find that out.
		const cache = new FakeCache();
		const urls = imageWarmTargets([
			entry({ cardKey: "en:base2-44" }),
			entry({ cardKey: "en:base1-45" }),
		]);
		const fetched: string[] = [];
		const fetcher = async (url: string) => {
			fetched.push(url);
			return imageResponse();
		};

		const first = await warmCorpusImages(urls, { cache: cache.asCache(), fetch: fetcher });
		expect(first.fetched).toBe(2);
		expect(fetched).toHaveLength(2);

		const second = await warmCorpusImages(urls, { cache: cache.asCache(), fetch: fetcher });
		expect(second.alreadyCached).toBe(2);
		expect(second.fetched).toBe(0);
		expect(second.bytesFetched).toBe(0);
		// The whole claim, in one line: a second run moved nothing over the tailnet.
		expect(fetched).toHaveLength(2);
	});

	it("counts the bytes it actually moved", async () => {
		const cache = new FakeCache();
		const progress = await warmCorpusImages(["/api/corpus/cards/a/image"], {
			cache: cache.asCache(),
			fetch: async () => imageResponse(1024),
		});

		expect(progress.bytesFetched).toBe(1024);
		expect(cache.stored.get("/api/corpus/cards/a/image")?.byteLength).toBe(1024);
	});

	it("keeps going when one image fails, and counts it", async () => {
		// A quota error on image 200 is how this ends on a phone that is nearly full. Stopping there
		// would leave the owner with no idea how much of their binder is warm.
		const cache = new FakeCache();
		const urls = [
			"/api/corpus/cards/a/image",
			"/api/corpus/cards/b/image",
			"/api/corpus/cards/c/image",
		];

		const progress = await warmCorpusImages(urls, {
			cache: cache.asCache(),
			concurrency: 1,
			fetch: async (url) => {
				if (url.includes("/b/")) throw new TypeError("the tailnet went away");
				return imageResponse();
			},
		});

		expect(progress.failed).toBe(1);
		expect(progress.fetched).toBe(2);
		expect(progress.done).toBe(3);
	});

	it("counts a refusal from the server as a failure rather than caching it", async () => {
		// Caching a 404 under an image URL would make `CacheFirst` serve that 404 for a year.
		const cache = new FakeCache();
		const progress = await warmCorpusImages(["/api/corpus/cards/a/image"], {
			cache: cache.asCache(),
			fetch: async () => new Response("no such card", { status: 404 }),
		});

		expect(progress.failed).toBe(1);
		expect(cache.stored.size).toBe(0);
	});
});

describe("progress is visible", () => {
	it("reports after every image, ending at the total", async () => {
		const cache = new FakeCache();
		const urls = Array.from({ length: 12 }, (_, index) => `/api/corpus/cards/${index}/image`);
		const seen: WarmProgress[] = [];

		const final = await warmCorpusImages(urls, {
			cache: cache.asCache(),
			fetch: async () => imageResponse(),
			onProgress: (progress) => seen.push(progress),
		});

		expect(seen).toHaveLength(12);
		expect(seen.map((p) => p.done)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(seen.every((p) => p.total === 12)).toBe(true);
		expect(final.done).toBe(12);
	});

	it("hands out a snapshot rather than the object it keeps counting in", async () => {
		// A shared object means every progress line React ever rendered says the same thing — the
		// final number — and the bar appears to jump from nothing to done.
		const cache = new FakeCache();
		const seen: WarmProgress[] = [];

		await warmCorpusImages(["/api/corpus/cards/a/image", "/api/corpus/cards/b/image"], {
			cache: cache.asCache(),
			concurrency: 1,
			fetch: async () => imageResponse(),
			onProgress: (progress) => seen.push(progress),
		});

		expect(seen[0]?.done).toBe(1);
		expect(seen[1]?.done).toBe(2);
	});

	it("stops between images when the owner asks it to", async () => {
		// 26 MiB is long enough that "start" without "stop" is a trap.
		const cache = new FakeCache();
		const controller = new AbortController();
		const urls = Array.from({ length: 20 }, (_, index) => `/api/corpus/cards/${index}/image`);

		const progress = await warmCorpusImages(urls, {
			cache: cache.asCache(),
			concurrency: 1,
			signal: controller.signal,
			fetch: async () => imageResponse(),
			onProgress: (current) => {
				if (current.done === 3) controller.abort();
			},
		});

		expect(progress.done).toBe(3);
		expect(progress.done).toBeLessThan(urls.length);
	});

	it("reports totals and then what was newly fetched, never a delta among totals", async () => {
		// The lesson the corpus panel already learned: `0 image(s)` sitting beside two totals reads
		// as data loss, and the *normal* outcome of a repeat warm is that nothing was fetched.
		const warm = warmSummary(
			{ total: 382, done: 382, fetched: 0, alreadyCached: 382, failed: 0, bytesFetched: 0 },
			false,
		);

		expect(warm).toContain("382 of 382 image(s) cached");
		expect(warm).toContain("none newly fetched");
	});

	it("says how far through it is while it runs", () => {
		const running = warmSummary(
			{ total: 382, done: 40, fetched: 40, alreadyCached: 0, failed: 0, bytesFetched: 2_400_000 },
			true,
		);

		expect(running).toContain("40 / 382");
		expect(running).toContain("2.3 MB");
	});
});

describe("it never starts on its own", () => {
	it("is reachable from exactly one screen, which is the one with the button on it", () => {
		// The criterion says *explicit and user-initiated*. A second caller is how that stops being
		// true, and it would not be visible in any behavioural test — the warm would simply have
		// happened.
		// Matched on the module's name rather than on one spelling of the path, so a caller added
		// from anywhere under `client/` is found whatever its relative depth.
		const importers = clientFiles().filter(
			(file) =>
				file !== "client/binder/image-warm.ts" &&
				readFileSync(join(REPO_ROOT, file), "utf8").includes("image-warm.ts"),
		);

		expect(importers).toEqual(["client/routes/offline-images.tsx"]);
	});

	it("sits on a screen with no effects at all, so nothing can fire it on mount", () => {
		// The strongest simple form of "never automatic": the panel has no `useEffect`. A warm
		// started on mount would move ~26 MiB the moment the owner opened /status on mobile data,
		// and they would find out from their bill.
		const panel = readFileSync(join(REPO_ROOT, "client/routes/offline-images.tsx"), "utf8");

		expect(panel).not.toMatch(/useEffect/);
		expect(panel).toMatch(/onClick=/);
	});
});

/** Every TypeScript source under `client/`, as repository-relative paths. */
function clientFiles(): string[] {
	const walk = (relative: string): string[] =>
		readdirSync(join(REPO_ROOT, relative), { withFileTypes: true }).flatMap((found) => {
			const path = `${relative}/${found.name}`;
			if (found.isDirectory()) return walk(path);
			return found.name.endsWith(".ts") || found.name.endsWith(".tsx") ? [path] : [];
		});
	return walk("client");
}
