import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { readCompletion } from "../server/copies/completion.ts";
import { disposeCopy, insertCopy } from "../server/copies/repository.ts";
import { corpusCards, corpusVariants } from "../server/db/schema.ts";
import type { CompletionDocument } from "../shared/copies.ts";
import { COMPLETION_PATH } from "../shared/copies.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * Completion, against a real corpus.
 *
 * The fixture holds **eight variants, one of them on a card flagged `missing_upstream`** — the
 * Erika's Gloom promo. So an untouched collection is `0 / 7`, with one variant left out, and the
 * two halves of the denominator rule are both reachable from here.
 */

const MISSING_UPSTREAM_KEY = { cardKey: "en:me02.5-002", variantId: "generated" };

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("completion", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function completion(): CompletionDocument {
		return readCompletion(temp.handle.db);
	}

	it("counts variants with at least one owned copy, not copies", () => {
		// The numerator is a count of *holes filled*. Two copies of one printing is a fact about
		// the collection and not about the masterset, so it moves the figure exactly once.
		insertCopy(
			temp.handle.db,
			{ id: A, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		insertCopy(
			temp.handle.db,
			{ id: B, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT, grader: "PSA", grade: 90 },
			1,
		);

		expect(completion().owned).toBe(1);

		insertCopy(temp.handle.db, { id: C, cardKey: "en:base1-45", variantId: SHARED_VARIANT }, 1);
		expect(completion().owned).toBe(2);
	});

	it("leaves a missing_upstream variant out of the denominator while it is unowned", () => {
		// Decision `01m04jea06`, first half: somebody else's data correction must not cap the owner
		// below 100% with a row nobody can ever buy.
		const figure = completion();
		expect(figure.owned).toBe(0);
		expect(figure.total).toBe(7);
		expect(figure.missingUpstreamExcluded).toBe(1);
	});

	it("puts a missing_upstream variant back in the denominator once it is owned", () => {
		// Second half: a card the owner physically holds never vanishes from the total. It is in
		// the binder, in their hand, and it counts.
		insertCopy(temp.handle.db, { id: A, ...MISSING_UPSTREAM_KEY }, 1);

		const figure = completion();
		expect(figure.owned).toBe(1);
		expect(figure.total).toBe(8);
		expect(figure.missingUpstreamExcluded).toBe(0);
	});

	it("moves as soon as a copy is recorded and again when it is disposed of", () => {
		// **The invalidation criterion, as behaviour.** Nothing caches the figure — a memo would
		// have to be invalidated from a corpus sync that runs in a *different OS process* and
		// cannot reach this one's memory — so the only way for it to be stale is for it to be
		// wrong, and these three reads would catch that.
		expect(completion().owned).toBe(0);

		insertCopy(
			temp.handle.db,
			{ id: A, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		expect(completion().owned).toBe(1);

		disposeCopy(temp.handle.db, A, { disposedAt: "2026-04-05", disposalKind: "sold" }, 2);
		expect(completion().owned).toBe(0);
	});

	it("goes down when a sync grows the masterset, which is correct for a masterset", () => {
		// Expected rather than guarded against: upstream adding a language or a printing makes the
		// target bigger, and the fraction of it held gets smaller. The figure is derived from the
		// corpus on every read, so it follows the corpus without anyone remembering to tell it.
		insertCopy(
			temp.handle.db,
			{ id: A, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		const before = completion();
		expect(before).toEqual({ owned: 1, total: 7, missingUpstreamExcluded: 1 });

		temp.handle.db
			.insert(corpusCards)
			.values({
				cardKey: "de:base2-44",
				language: "de",
				cardId: "base2-44",
				setId: "base2",
				setName: "Dschungel",
				localId: "44",
				name: "Duflor",
				membershipReason: "dex",
				provenance: "tcgdex",
				firstSeenAt: 1,
				lastSyncedAt: 1,
			})
			.run();
		temp.handle.db
			.insert(corpusVariants)
			.values({
				cardKey: "de:base2-44",
				variantId: "generated",
				provenance: "tcgdex",
				firstSeenAt: 1,
				lastSyncedAt: 1,
			})
			.run();

		const after = completion();
		expect(after.owned).toBe(1);
		expect(after.total).toBe(8);
		expect(after.owned / after.total).toBeLessThan(before.owned / before.total);
	});

	it("stops counting a variant the sync has flagged as gone, unless it is held", () => {
		// A sync flags rather than deletes, so the row is still there and the denominator rule is
		// what decides whether it counts. Both answers are exercised on the same row.
		insertCopy(temp.handle.db, { id: A, cardKey: "en:swshp-SWSH040", variantId: "promo" }, 1);
		expect(completion().total).toBe(7);

		temp.handle.sqlite.exec(
			"update corpus_variants set missing_upstream = 1 where card_key = 'en:swshp-SWSH040'",
		);
		// Still counted, because the owner holds it.
		expect(completion().total).toBe(7);
		expect(completion().owned).toBe(1);

		disposeCopy(temp.handle.db, A, { disposedAt: "2026-05-06" }, 2);
		// Now it is neither held nor upstream, so it leaves the target.
		const figure = completion();
		expect(figure.owned).toBe(0);
		expect(figure.total).toBe(6);
		expect(figure.missingUpstreamExcluded).toBe(2);
	});

	it("is served over HTTP as the two numbers and nothing else", async () => {
		// How completion is *presented* numerically is still open in the spec, so the route carries
		// what the spec defines — a numerator, a denominator and what the rule left out — and no
		// percentage. Rounding here would throw away the only two figures anybody has agreed on.
		insertCopy(
			temp.handle.db,
			{ id: A, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);

		const response = await createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => 1_800_000_000_000,
		}).request(COMPLETION_PATH);

		expect(response.status).toBe(200);
		// Never cached: a phone holding yesterday's figure after recording a card would be
		// reporting the opposite of what the owner just did.
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ owned: 1, total: 7, missingUpstreamExcluded: 1 });
	});
});
