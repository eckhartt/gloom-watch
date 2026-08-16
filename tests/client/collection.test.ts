import { describe, expect, it } from "vitest";
import {
	BINDER_QUERY_KEY,
	COMPLETION_QUERY_KEY,
	newCopyId,
	queryKeysInvalidatedBy,
	variantCopiesQueryKey,
} from "../../client/collection.ts";

/**
 * What a write throws away, and what identifies a copy.
 *
 * The spec's rule is *invalidate any cached figure on corpus sync and on copy creation or
 * disposal*. The server keeps no such figure — completion is computed per request precisely so a
 * sync running in another OS process cannot leave a stale one behind — so the only cache that can
 * actually go stale is the client's, and this is where that rule is kept.
 */

describe("what a write invalidates", () => {
	it("throws away the binder and completion when a copy is recorded or disposed of", () => {
		// The quiet version of this mistake is the dangerous one: invalidating only the list the
		// copy came from leaves the grid showing the card as needed and completion showing the
		// number from before, agreeing with each other and disagreeing with the database.
		const keys = queryKeysInvalidatedBy("copy-write");
		expect(keys).toContainEqual(BINDER_QUERY_KEY);
		expect(keys).toContainEqual(COMPLETION_QUERY_KEY);
	});

	it("throws away completion on a corpus sync too, because the denominator is not constant", () => {
		// A sync that picks up a new language or a new printing makes the masterset bigger and
		// completion goes *down*. That is correct for a masterset, and it is exactly the figure a
		// client holding yesterday's answer would get wrong.
		expect(queryKeysInvalidatedBy("corpus-sync")).toContainEqual(COMPLETION_QUERY_KEY);
	});

	it("keys a variant's copies on the card and the printing together", () => {
		// `variant_id` alone is shared by 264 cards in the live corpus. A cache keyed on it would
		// serve one card's copies for another's sheet.
		expect(variantCopiesQueryKey("en:base2-44", "shared")).not.toEqual(
			variantCopiesQueryKey("en:base1-45", "shared"),
		);
	});
});

describe("the identifier a copy is created with", () => {
	it("is a UUID, which is what the server will accept", () => {
		// The identifier being the client's is what makes an outbox replay land in the same row.
		// The server refuses anything not UUID-shaped, so a fallback producing something else
		// would fail at the boundary — which is why the shape is pinned here rather than assumed.
		const id = newCopyId();
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(newCopyId()).not.toBe(id);
	});
});
