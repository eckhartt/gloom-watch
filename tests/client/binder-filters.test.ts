import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BinderFilters } from "../../client/binder/filters.ts";
import {
	activeFilterCount,
	FILTER_AXES,
	filterEntries,
	filterFacets,
	filtersFromSearch,
	matchesFilters,
	NO_FILTERS,
	parseBinderSearch,
	searchFromFilters,
	toggleFilterValue,
} from "../../client/binder/filters.ts";
import { binderQueryOptions } from "../../client/collection.ts";
import type { BinderEntry } from "../../shared/contract.ts";

/**
 * The filters, as behaviour.
 *
 * Three things here would each ship a binder that looks right and answers wrong, and they are
 * what these tests exist for:
 *
 * 1. **The combination rule inverted.** OR within an axis and AND across is the spec's ruling.
 *    Backwards, any two-value selection returns nothing — which the owner reads as *I own none of
 *    these* rather than as a bug, because a masterset is mostly holes. The two tests that catch it
 *    assert the *direction* the count moves, so they fail under the inversion rather than under a
 *    changed fixture.
 * 2. **`stamps` treated as a scalar.** It is a list; a variant may carry `1st-edition` *and*
 *    `set-logo`. Equality instead of membership silently drops every multi-stamped printing.
 * 3. **A URL that throws.** `validateSearch` runs before the route renders, so anything it cannot
 *    read takes the whole binder down — for a URL somebody hand-typed, or bookmarked three months
 *    ago against a corpus that has since been re-synced.
 */

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

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
		rarity: "Uncommon",
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

/** A filter selection, written the way a reader thinks of one: only the axes that are on. */
function filters(selection: Partial<BinderFilters>): BinderFilters {
	return { ...NO_FILTERS, ...selection };
}

/** What the URL would carry for a selection, and what comes back off it. */
function throughTheUrl(selection: BinderFilters) {
	const url = defaultStringifySearch(searchFromFilters(selection) as Record<string, unknown>);
	return { url, back: parseBinderSearch(defaultParseSearch(url)) };
}

/**
 * What the component actually reads, which is **not** what `validateSearch` returned.
 *
 * TanStack Router validates per matched route and merges each route's result over its parent's.
 * The root route has no validator, so the raw parsed query survives underneath and a parameter
 * this route's validator rejected is still there: `?priority=7&state=needed` reaches the binder
 * as `{ priority: 7, state: ["needed"] }`. Every URL test below goes through this rather than
 * through the validator alone, because the validator alone is not the path the app takes.
 */
function asTheComponentSeesIt(query: string): Record<string, unknown> {
	const raw = defaultParseSearch(query);
	return { ...raw, ...parseBinderSearch(raw) };
}

const EN_HOLO = entry({ key: "en holo", language: "en", finish: "holo" });
const JA_HOLO = entry({ key: "ja holo", language: "ja", finish: "holo", setId: "SV3" });
const EN_REVERSE = entry({ key: "en reverse", language: "en", finish: "reverse" });
const EN_NORMAL = entry({ key: "en normal", language: "en", finish: "normal" });
const SHELF: readonly BinderEntry[] = [EN_HOLO, JA_HOLO, EN_REVERSE, EN_NORMAL];

describe("multi-select within an axis is OR", () => {
	it("widens the result when a second value is added to one axis", () => {
		// **The inversion test.** Under AND-within — the mistake this guards — asking for holo *and*
		// reverse asks for a printing that is both, and the answer is nothing at all. The assertion
		// is on the direction as well as the count, so it cannot be satisfied by an empty result.
		const one = filterEntries(SHELF, filters({ finish: ["holo"] }));
		const two = filterEntries(SHELF, filters({ finish: ["holo", "reverse"] }));

		expect(one).toHaveLength(2);
		expect(two).toHaveLength(3);
		expect(two.length).toBeGreaterThan(one.length);
	});

	it("treats an axis with nothing selected as no constraint at all", () => {
		expect(filterEntries(SHELF, NO_FILTERS)).toHaveLength(SHELF.length);
		expect(matchesFilters(EN_NORMAL, NO_FILTERS)).toBe(true);
	});

	it("hands back the same array when nothing is selected, rather than a copy of 817 entries", () => {
		// Not a micro-optimisation: an unfiltered binder re-rendering must not hand the virtualiser
		// a new array identity every time something unrelated changes.
		expect(filterEntries(SHELF, NO_FILTERS)).toBe(SHELF);
	});
});

describe("across axes it is AND", () => {
	it("narrows the result when a second axis is added", () => {
		// The other half of the inversion. Under OR-across, adding a language would *add* every
		// Japanese card to a finish selection instead of cutting it down to the Japanese holos.
		const finishOnly = filterEntries(SHELF, filters({ finish: ["holo"] }));
		const both = filterEntries(SHELF, filters({ finish: ["holo"], language: ["ja"] }));

		expect(finishOnly).toHaveLength(2);
		expect(both).toHaveLength(1);
		expect(both[0]?.key).toBe("ja holo");
	});

	it("returns nothing when two axes cannot both be satisfied", () => {
		// A real empty result, and it must be empty — this is the case an OR-across implementation
		// would answer with three cards.
		expect(filterEntries(SHELF, filters({ finish: ["reverse"], language: ["ja"] }))).toEqual([]);
	});
});

describe("owned, needed and priority", () => {
	const owned = entry({ key: "owned", ownedCopies: 2 });
	const needed = entry({ key: "needed", ownedCopies: 0 });
	const ranked = entry({ key: "ranked", ownedCopies: 0, priority: 3 });

	it("filters to the holes, which is the Gap and is a filter rather than a screen", () => {
		const shelf = [owned, needed, ranked];
		expect(filterEntries(shelf, filters({ state: ["needed"] })).map((e) => e.key)).toEqual([
			"needed",
			"ranked",
		]);
		expect(filterEntries(shelf, filters({ state: ["owned"] })).map((e) => e.key)).toEqual([
			"owned",
		]);
	});

	it("counts copies rather than asking a yes-or-no question of the entry", () => {
		// `ownedCopies` is a count because a PSA 9 and a raw copy are two rows. Anything above zero
		// is owned; the filter must not compare against 1.
		expect(matchesFilters(entry({ ownedCopies: 5 }), filters({ state: ["owned"] }))).toBe(true);
	});

	it("matches a rung by its number, and leaves an unranked variant out of any rung", () => {
		// Priority is a number on the entry and a string in the URL. `null` is *unset*, and `0` is a
		// real rung — a conversion that turned one into the other would file every unranked variant
		// under the lowest priority.
		expect(matchesFilters(ranked, filters({ priority: ["3"] }))).toBe(true);
		expect(matchesFilters(ranked, filters({ priority: ["0"] }))).toBe(false);
		expect(matchesFilters(needed, filters({ priority: ["0"] }))).toBe(false);
		expect(matchesFilters(entry({ priority: 0 }), filters({ priority: ["0"] }))).toBe(true);
	});
});

describe("stamps is a list, not a scalar", () => {
	const multi = entry({ key: "multi", stamps: ["1st-edition", "set-logo"] });
	const single = entry({ key: "single", stamps: ["1st-edition"] });
	const bare = entry({ key: "bare", stamps: [] });

	it("matches a variant carrying several stamps against a single-stamp selection", () => {
		// The membership test. An equality test against the whole list — or against `stamps[0]` —
		// answers `false` here, and every multi-stamped printing disappears from the filter with no
		// error anywhere.
		expect(matchesFilters(multi, filters({ stamps: ["set-logo"] }))).toBe(true);
		expect(matchesFilters(multi, filters({ stamps: ["1st-edition"] }))).toBe(true);
	});

	it("widens across the list axis too, rather than demanding a variant carry both", () => {
		const shelf = [multi, single, bare];
		expect(filterEntries(shelf, filters({ stamps: ["set-logo"] }))).toHaveLength(1);
		expect(filterEntries(shelf, filters({ stamps: ["1st-edition", "set-logo"] }))).toHaveLength(2);
	});

	it("leaves an unstamped variant out, because no stamp is not the stamp you asked for", () => {
		expect(matchesFilters(bare, filters({ stamps: ["1st-edition"] }))).toBe(false);
	});

	it("does the same for an axis upstream never set", () => {
		expect(matchesFilters(entry({ foil: null }), filters({ foil: ["cracked-ice"] }))).toBe(false);
		expect(matchesFilters(entry({ subtype: null }), filters({ subtype: ["shadowless"] }))).toBe(
			false,
		);
	});
});

describe("size is stored, not filtered", () => {
	it("is not one of the axes", () => {
		// The spec says so explicitly, and `size` sits beside the other four print axes everywhere
		// else — in the schema, on the wire and in the sheet — so its absence has to be deliberate
		// and pinned rather than an oversight waiting to be tidied up.
		expect([...FILTER_AXES]).not.toContain("size");
	});

	it("ignores a URL that names it", () => {
		expect(parseBinderSearch(defaultParseSearch("?size=standard"))).toEqual({});
	});

	it("does not separate two variants that differ only in size", () => {
		const standard = entry({ key: "standard", size: "standard" });
		const jumbo = entry({ key: "jumbo", size: "jumbo" });
		expect(filterEntries([standard, jumbo], filters({ finish: ["normal"] }))).toHaveLength(2);
	});
});

describe("the filter state round-trips through the URL", () => {
	it("puts nothing in the URL when nothing is selected", () => {
		const { url, back } = throughTheUrl(NO_FILTERS);
		expect(url).toBe("");
		expect(back).toEqual({});
		expect(filtersFromSearch(back)).toEqual(NO_FILTERS);
	});

	it("survives a single value", () => {
		const selection = filters({ state: ["needed"] });
		const { url, back } = throughTheUrl(selection);

		expect(url).not.toBe("");
		expect(filtersFromSearch(back)).toEqual(selection);
	});

	it("survives several values on several axes", () => {
		const selection = filters({
			finish: ["holo", "reverse"],
			language: ["en", "ja"],
			stamps: ["1st-edition"],
			state: ["needed"],
			priority: ["2", "3"],
			set: ["base2"],
		});

		expect(filtersFromSearch(throughTheUrl(selection).back)).toEqual(selection);
	});

	it("writes the same URL whatever order the owner tapped the chips in", () => {
		// Otherwise toggling a chip off and on again rewrites the address bar, and two URLs that
		// mean the same thing are two different bookmarks.
		const one = toggleFilterValue(
			toggleFilterValue(NO_FILTERS, "finish", "reverse"),
			"finish",
			"holo",
		);
		const other = toggleFilterValue(
			toggleFilterValue(NO_FILTERS, "finish", "holo"),
			"finish",
			"reverse",
		);

		expect(throughTheUrl(one).url).toBe(throughTheUrl(other).url);
	});

	it("reads a hand-typed scalar as a one-value selection", () => {
		// `?language=ja` is what somebody types. It is not malformed and must not be discarded.
		expect(parseBinderSearch(defaultParseSearch("?language=ja"))).toEqual({ language: ["ja"] });
	});

	it("reads a repeated key as the list it obviously means", () => {
		expect(parseBinderSearch(defaultParseSearch("?language=ja&language=en"))).toEqual({
			language: ["en", "ja"],
		});
	});

	it("reads a bare number, because the query decoder turns one into a number before this sees it", () => {
		expect(parseBinderSearch(defaultParseSearch("?priority=3"))).toEqual({ priority: ["3"] });
	});
});

describe("a malformed or stale URL falls back rather than throwing", () => {
	const hostile = [
		`?finish=${encodeURIComponent('{"a":1}')}`,
		"?state=true",
		`?state=${encodeURIComponent("[1,2,3]")}`,
		"?priority=7",
		`?priority=${encodeURIComponent('["nine"]')}`,
		"?language=",
		`?stamps=${encodeURIComponent("[null]")}`,
		`?set=${encodeURIComponent('[{"id":"base2"}]')}`,
		"?finish=%E2%80%8B",
		// The one that actually took the binder down. `priority=7` is rejected by the validator and
		// arrives anyway, underneath a `state` that was accepted — so the predicate runs, reaches an
		// axis holding the number 7, and calls `.some` on it.
		"?priority=7&state=needed",
		"?state=true&stamps=%5Bnull%5D",
	];

	it.each(hostile)("answers %s with a selection rather than an exception", (query) => {
		// **Through the merge the router actually performs, not through the validator alone.**
		// `validateSearch` cannot throw — the tests above pin that — and the binder still went to
		// the router's error page on two of these, because the value the component read was never
		// the value the validator returned.
		const search = asTheComponentSeesIt(query);
		expect(() => filtersFromSearch(search)).not.toThrow();
		expect(filterEntries(SHELF, filtersFromSearch(search))).toBeDefined();
	});

	it("filters correctly on the half of a URL that survived validation", () => {
		// Not merely "does not throw": the accepted axis must still do its job while the rejected
		// one rides along beside it.
		const search = asTheComponentSeesIt("?priority=7&state=needed");

		expect(search.priority).toBe(7);
		expect(
			filterEntries([entry({ key: "owned", ownedCopies: 1 }), ...SHELF], filtersFromSearch(search)),
		).toHaveLength(SHELF.length);
	});

	it("drops a priority that is not on the 0–3 scale, and keeps a set that merely does not exist", () => {
		// The distinction matters. A rung of `7` is not a thing the app has ever been able to mean,
		// so it goes. A set id is an open vocabulary — the corpus can gain and lose sets — so a
		// stale one is kept, matches nothing, and stays visible in the URL as what the owner asked
		// for rather than silently becoming an unfiltered binder.
		expect(parseBinderSearch(defaultParseSearch("?priority=7"))).toEqual({});
		expect(parseBinderSearch(defaultParseSearch("?set=gone-in-2019"))).toEqual({
			set: ["gone-in-2019"],
		});
		expect(filterEntries(SHELF, filters({ set: ["gone-in-2019"] }))).toEqual([]);
	});

	it("keeps the good half of a URL whose other half is nonsense", () => {
		const search = parseBinderSearch(
			defaultParseSearch(`?state=needed&priority=99&finish=${encodeURIComponent('{"a":1}')}`),
		);
		expect(search).toEqual({ state: ["needed"] });
	});

	it("drops parameters that are not filters at all", () => {
		// A bookmark from a paged prototype, or a tracking parameter pasted in by a share sheet.
		expect(parseBinderSearch(defaultParseSearch("?page=2&sort=oldest&utm_source=x"))).toEqual({});
	});

	it("counts only the axes that actually narrow anything", () => {
		expect(activeFilterCount(NO_FILTERS)).toBe(0);
		expect(activeFilterCount(filters({ state: ["needed"], language: ["ja"] }))).toBe(2);
	});
});

describe("filtering happens over the cached document, and touches nothing else", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("makes no request when the filter changes", async () => {
		// The criterion is *no request per filter change*, and the honest way to show it without a
		// browser is to take the network away and filter anyway. The document comes out of the query
		// cache exactly as it would with the tailnet unreachable and the service worker's last good
		// copy behind it.
		vi.stubGlobal("fetch", () => {
			throw new Error("filtering must not touch the network");
		});

		const client = new QueryClient();
		client.setQueryData(binderQueryOptions().queryKey, {
			generatedAt: 1_800_000_000_000,
			entries: SHELF,
		});

		const cached = client.getQueryData<{ entries: readonly BinderEntry[] }>(
			binderQueryOptions().queryKey,
		);
		const visible = filterEntries(cached?.entries ?? [], filters({ finish: ["holo"] }));

		expect(visible.map((e) => e.key)).toEqual(["en holo", "ja holo"]);
		client.clear();
	});

	it("still runs its query function while the client believes it is offline", async () => {
		// **The offline criterion turns on this and nothing else on the client's side.** TanStack
		// Query's default network mode does not call the query function at all once it believes
		// there is no connection — and a phone put into aeroplane mode fires the `offline` event
		// that tells it so. The request would never be made, the service worker's `NetworkFirst`
		// route would never be asked, and the binder already sitting in the phone's cache would
		// stay behind a spinner.
		//
		// Asserted as behaviour rather than as a string: with the default mode this races the
		// timeout and loses, because the query is paused rather than slow.
		onlineManager.setOnline(false);
		const client = new QueryClient();
		try {
			let ran = false;
			const document = await Promise.race([
				client.fetchQuery({
					...binderQueryOptions(),
					queryFn: async () => {
						ran = true;
						return { generatedAt: 1, entries: SHELF };
					},
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("the query was paused and never ran")), 500),
				),
			]);

			expect(ran).toBe(true);
			expect(filterEntries(document.entries, filters({ state: ["needed"] }))).toHaveLength(4);
		} finally {
			client.clear();
			onlineManager.setOnline(true);
		}
	});

	it("has no way to make a request, because the predicate does not know what one is", () => {
		// The structural half. The predicate can only stop calling the network if it cannot call it:
		// no transport imported, nothing to await.
		const source = readFileSync(join(REPO_ROOT, "client/binder/filters.ts"), "utf8");

		expect(source).not.toMatch(/\bfetch\s*\(/);
		expect(source).not.toMatch(/from\s+"\.\.\/api\.ts"/);
		expect(source).not.toMatch(/\basync\b/);
	});
});

describe("the options the sheet offers", () => {
	const shelf = [
		entry({ key: "a", language: "ja", setId: "SV3", setName: "黒炎の支配者", finish: "holo" }),
		entry({ key: "b", language: "en", setId: "base2", setName: "Jungle", finish: "normal" }),
		entry({
			key: "c",
			language: "en",
			setId: "base1",
			setName: "Base Set",
			finish: "holo",
			subtype: "shadowless",
			stamps: ["1st-edition", "set-logo"],
			foil: "cracked-ice",
		}),
	];

	it("reads its values off the document rather than a hard-coded list", () => {
		// The corpus canonicalises upstream's localised axis strings and *keeps* what it could not
		// place. A hard-coded vocabulary would hide exactly those values — the ones worth looking
		// at — and would offer options that match nothing.
		const facets = filterFacets([...shelf, entry({ key: "d", foil: "rainbow-mirror" })]);

		expect(facets.foil.map((o) => o.value)).toEqual(["cracked-ice", "rainbow-mirror"]);
		expect(facets.stamps.map((o) => o.value)).toEqual(["1st-edition", "set-logo"]);
		expect(facets.finish.map((o) => o.value)).toEqual(["holo", "normal"]);
	});

	it("labels a set with its name and keeps the document's order", () => {
		// The document arrives ordered by release date descending, so the set list reads in the same
		// order as the grid it filters rather than alphabetically against it.
		const facets = filterFacets(shelf);
		expect(facets.set).toEqual([
			{ value: "SV3", label: "黒炎の支配者" },
			{ value: "base2", label: "Jungle" },
			{ value: "base1", label: "Base Set" },
		]);
	});

	it("falls back to the set id when the sets phase has not reached that set yet", () => {
		const facets = filterFacets([entry({ setId: "swshp", setName: null })]);
		expect(facets.set).toEqual([{ value: "swshp", label: "swshp" }]);
	});

	it("offers every priority rung even when nothing has been ranked", () => {
		// A dial that only appears after it has been turned is a dial nobody finds. No copy has ever
		// been created on the live database, so this is today's state, not a hypothetical.
		const facets = filterFacets(shelf);
		expect(facets.priority.map((o) => o.value)).toEqual(["0", "1", "2", "3"]);
		expect(facets.priority.at(-1)?.label).toContain("instant");
	});

	it("offers owned and needed against a collection holding neither yet", () => {
		expect(filterFacets([]).state.map((o) => o.value)).toEqual(["owned", "needed"]);
	});

	it("carries no counts, because a tally of needed cards is the completion figure in disguise", () => {
		// How completion is presented numerically is still open in the spec, and the binder ticket
		// forbids an aggregate above the grid. An option that read `needed (817)` would settle both
		// by accident.
		const option = filterFacets(shelf).language[0];
		expect(Object.keys(option ?? {}).toSorted()).toEqual(["label", "value"]);
	});
});
