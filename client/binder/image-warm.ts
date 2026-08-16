/**
 * The bulk image warm — filling the corpus image cache on purpose, before a card fair or a
 * flight.
 *
 * **Explicit, user-initiated, never automatic.** All three words are load-bearing. It moves ~380
 * images and ~26 MiB over the tailnet; doing that on a cold open, or on a metered connection the
 * owner did not choose, would be a hostile surprise. Nothing in this module runs on import and
 * nothing calls it from an effect — `tests/client/image-warm.test.ts` holds that.
 *
 * **It writes into the same cache `CacheFirst` reads**, by the name that route uses, so a warmed
 * image and a browsed image are one entry rather than two copies. That is the entire point: the
 * service worker serves the grid from this cache when there is no tailnet.
 *
 * **Repeatable and cheap when warm.** iOS evicts an origin's Cache Storage without notice, so the
 * owner will run this again, and most of the time most of it is already there. An image already
 * in the cache costs one cache lookup and no request at all.
 */

import type { BinderEntry } from "../../shared/contract.ts";
import { corpusCardImagePath } from "../../shared/contract.ts";
import { CORPUS_IMAGE_CACHE } from "../sw/caching.ts";

/**
 * Six at a time.
 *
 * A phone opening 380 sockets at once over a tailnet is not faster, and on a shared box it is
 * rude — the same server is answering the binder document and the sync. Six keeps the pipe full
 * without the warm becoming the only thing the box is doing.
 */
const DEFAULT_CONCURRENCY = 6;

export interface WarmProgress {
	/** How many images the masterset has. Fixed for the run. */
	readonly total: number;
	/** How many have been dealt with, however they turned out. What a progress line counts. */
	readonly done: number;
	/** Newly pulled over the tailnet. */
	readonly fetched: number;
	/** Already in the cache, and therefore free. */
	readonly alreadyCached: number;
	/** The server refused, the network failed, or the cache would not take it. */
	readonly failed: number;
	/** Bytes actually moved. Zero on a re-run that finds everything already there. */
	readonly bytesFetched: number;
}

export interface WarmOptions {
	/** The image cache, already open. Injected so this is exercisable without a browser. */
	readonly cache: Cache;
	readonly fetch: (url: string) => Promise<Response>;
	/** Called after every image. Progress has to be visible: a silent 26 MiB looks broken. */
	readonly onProgress?: (progress: WarmProgress) => void;
	/** Stops the run between images. 26 MiB is long enough that the owner must be able to stop it. */
	readonly signal?: AbortSignal;
	readonly concurrency?: number;
}

/**
 * Which images the warm should fetch: **one per card that has one, not one per entry.**
 *
 * Images attach to the card, so the four printings of Base Set Gloom are four binder entries
 * sharing one picture. Warming per entry would ask the box for the same bytes four times — on the
 * live corpus, 817 requests for 382 images. Cards upstream carries no image for are skipped
 * entirely rather than fetched and 404'd.
 */
export function imageWarmTargets(entries: readonly BinderEntry[]): readonly string[] {
	const cardKeys = new Set<string>();
	for (const entry of entries) {
		if (entry.hasImage) cardKeys.add(entry.cardKey);
	}
	return [...cardKeys].map(corpusCardImagePath);
}

/**
 * Open the cache the service worker's `CacheFirst` route writes to.
 *
 * `null` rather than a throw when Cache Storage is not there — a page served over plain HTTP to
 * the box's LAN address is not a secure context, which is a real way to open this app while
 * debugging, and the answer to that is a sentence rather than a stack trace.
 */
export async function openCorpusImageCache(): Promise<Cache | null> {
	if (typeof caches === "undefined") return null;
	return caches.open(CORPUS_IMAGE_CACHE);
}

/**
 * Warm the cache, reporting after every image.
 *
 * Failures are counted and the run continues. A quota error on image 200 is the expected way this
 * ends on a phone whose storage is nearly full, and stopping there would leave the owner with no
 * idea how much of their binder is actually warm.
 */
export async function warmCorpusImages(
	urls: readonly string[],
	options: WarmOptions,
): Promise<WarmProgress> {
	const progress = {
		total: urls.length,
		done: 0,
		fetched: 0,
		alreadyCached: 0,
		failed: 0,
		bytesFetched: 0,
	};

	let next = 0;

	const worker = async (): Promise<void> => {
		while (next < urls.length) {
			if (options.signal?.aborted === true) return;

			const url = urls[next];
			next += 1;
			if (url === undefined) return;

			try {
				const held = await options.cache.match(url);
				if (held !== undefined) {
					// The cheap path, and the one most of a re-run takes. No request is made at all.
					progress.alreadyCached += 1;
				} else {
					const response = await options.fetch(url);
					if (response.ok) {
						// Read the copy, store the original. `cache.put` consumes the body, and the byte
						// count is the only honest way to say what this cost the owner's connection.
						const bytes = await response.clone().arrayBuffer();
						await options.cache.put(url, response);
						progress.fetched += 1;
						progress.bytesFetched += bytes.byteLength;
					} else {
						progress.failed += 1;
					}
				}
			} catch {
				// A dropped tailnet, or Cache Storage refusing another byte. Either way this image did
				// not land, the rest still can, and the count says so.
				progress.failed += 1;
			}

			progress.done += 1;
			options.onProgress?.({ ...progress });
		}
	};

	const lanes = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, urls.length));
	await Promise.all(Array.from({ length: lanes }, worker));

	return { ...progress };
}

/** `26.1 MB`. Whole bytes below a kilobyte, because a warm that moved 300 B should say so. */
export function formatWarmBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * The progress line.
 *
 * **Totals, then what was newly fetched** — the lesson the corpus panel already learned the hard
 * way. `0 image(s)` next to two totals reads as data loss, and a re-run of this that found
 * everything already cached would otherwise report exactly that.
 */
export function warmSummary(progress: WarmProgress, running: boolean): string {
	if (running) {
		return `${progress.done} / ${progress.total} — ${formatWarmBytes(progress.bytesFetched)} fetched`;
	}

	const cached = progress.fetched + progress.alreadyCached;
	const moved =
		progress.fetched === 0
			? "none newly fetched"
			: `${progress.fetched} newly fetched, ${formatWarmBytes(progress.bytesFetched)}`;

	return (
		`${cached} of ${progress.total} image(s) cached — ${moved}` +
		(progress.failed > 0 ? `, ${progress.failed} failed` : "")
	);
}
