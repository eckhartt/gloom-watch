import { describe, expect, it } from "vitest";
import {
	CORPUS_IMAGE_CACHE,
	isAppShellNavigation,
	isBinderDocumentPath,
	isCorpusImagePath,
} from "../../client/sw/caching.ts";
import { corpusCardImagePath } from "../../shared/contract.ts";

/**
 * Which requests the service worker's runtime caches actually claim.
 *
 * A route that matches nothing fails in the quietest way this project has: everything works
 * perfectly on the tailnet and the binder is blank at the card fair. There is no way to notice
 * that from a development machine, so the matchers are checked here instead.
 */
describe("the corpus image route", () => {
	it("matches the path the client actually requests, colon and all", () => {
		// `card_key` is `{language}:{card_id}`, so the path arrives percent-encoded as
		// `en%3Abase2-44`. A matcher written for the characters somebody expected in an
		// identifier would match none of the 382 images in the corpus.
		const path = corpusCardImagePath("en:base2-44");

		expect(path).toBe("/api/corpus/cards/en%3Abase2-44/image");
		expect(isCorpusImagePath(path)).toBe(true);
	});

	it("matches a hand-added card's image path too", () => {
		expect(
			isCorpusImagePath(corpusCardImagePath("manual:11111111-1111-4111-8111-111111111111")),
		).toBe(true);
	});

	it("matches a Japanese set's card, whose id is uppercase", () => {
		expect(isCorpusImagePath(corpusCardImagePath("ja:SV3-002"))).toBe(true);
	});

	it("does not claim the rest of the API", () => {
		// `CacheFirst` on any of these would serve the owner a health document or a sync job from
		// last week and never go to the network again.
		expect(isCorpusImagePath("/api/health")).toBe(false);
		expect(isCorpusImagePath("/api/corpus/status")).toBe(false);
		expect(isCorpusImagePath("/api/corpus/sync")).toBe(false);
		expect(isCorpusImagePath("/api/corpus/cards/en%3Abase2-44")).toBe(false);
		expect(isCorpusImagePath("/api/binder")).toBe(false);
		expect(isCorpusImagePath("/api/listings")).toBe(false);
	});

	it("keeps its cached bytes in a cache of its own", () => {
		// Separate from the precache and from the binder document, so a worker update that clears
		// outdated precaches does not throw away 26 MiB of card art the phone would have to
		// re-download over a tailnet.
		expect(CORPUS_IMAGE_CACHE).not.toBe("");
	});
});

describe("the binder document route", () => {
	it("matches the one document and nothing near it", () => {
		expect(isBinderDocumentPath("/api/binder")).toBe(true);
		expect(isBinderDocumentPath("/api/binder/44")).toBe(false);
		expect(isBinderDocumentPath("/binder")).toBe(false);
		expect(isBinderDocumentPath("/api/health")).toBe(false);
		expect(isBinderDocumentPath("/api/listings")).toBe(false);
	});
});

describe("app-shell navigation", () => {
	it("does not claim /unlock, so the server gate is not replaced by Not Found", () => {
		expect(isAppShellNavigation("/unlock")).toBe(false);
		expect(isAppShellNavigation("/api/unlock")).toBe(false);
		expect(isAppShellNavigation("/")).toBe(true);
		expect(isAppShellNavigation("/feed")).toBe(true);
	});
});
