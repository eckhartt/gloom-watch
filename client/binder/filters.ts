/**
 * The binder's filters: which axes narrow the grid, how they read off a URL, and the one
 * predicate that decides whether an entry survives them.
 *
 * **Everything here is pure and client-side.** Nothing in this module fetches. `GET /api/binder`
 * takes no parameters and must keep taking none — the service worker caches by URL, so a URL that
 * varied by filter would leave it holding one arbitrary slice of the masterset instead of the
 * masterset. Filtering runs over the ~817-entry document that is already in memory, which is what
 * makes it work with the tailnet unreachable.
 *
 * **The combination rule is the whole design and it is easy to get backwards.** Multi-select
 * within one axis is **OR** — a second finish *widens* the result. Across axes it is **AND** — a
 * second language *narrows* it. Inverted, any two-value selection silently returns nothing, which
 * reads as "I own none of these" rather than as a bug.
 *
 * **`size` is stored and not filtered.** The spec says so explicitly in the variant model, even
 * though `size` sits beside the other four print axes in the schema and in the sheet. It is
 * absent from `FILTER_AXES` on purpose; do not add it because the shape looks incomplete.
 */

import type { BinderEntry } from "../../shared/contract.ts";
import { MAX_PRIORITY, PRIORITY_LEVELS } from "../../shared/copies.ts";

/**
 * The eight filterable axes, in the order the filter sheet lists them.
 *
 * `set` is last because it is the long one — 137 (language, set) pairs live on the box — and
 * every other section has to be reachable without scrolling past it.
 */
export const FILTER_AXES = [
	"state",
	"priority",
	"language",
	"finish",
	"subtype",
	"stamps",
	"foil",
	"set",
] as const;

export type FilterAxis = (typeof FILTER_AXES)[number];

/** The language the binder opens on. Missing `language` in the URL means this, not every language. */
export const DEFAULT_LANGUAGE = "en";

/**
 * What is selected on each axis. Total: every axis is present, an unselected one being an empty
 * list, so the predicate never has to ask whether a key exists.
 *
 * Values are strings on every axis, priority included. A priority is a number on the entry and a
 * `"3"` here, converted at the one comparison site below — one axis shape means one URL codec,
 * one toggle and one predicate rather than eight of each, and the conversion is a `String()` in a
 * place a reader can see.
 *
 * `number` is not an axis. It is a single typed collector number, not a multi-select, and it
 * lives beside the chips rather than inside the sheet.
 */
export type BinderFilters = Readonly<Record<FilterAxis, readonly string[]>> & {
	readonly number: string;
};

/**
 * What rides in the URL: the same axes, with the empty ones **omitted**.
 *
 * Omitted rather than empty because TanStack Router's stringifier drops `undefined` and keeps
 * `[]`, so a total shape would put `?state=%5B%5D&priority=%5B%5D&…` on an unfiltered binder.
 *
 * `language` is the exception. A missing key is the default (English). An explicit empty list is
 * every language — the owner turned EN off. Without that distinction, toggling EN off would
 * rewrite the URL to nothing and English would come straight back.
 */
export type BinderSearch = { readonly [K in FilterAxis]?: readonly string[] } & {
	readonly number?: string;
};

export const NO_FILTERS: BinderFilters = Object.freeze({
	state: [],
	priority: [],
	language: [],
	finish: [],
	subtype: [],
	stamps: [],
	foil: [],
	set: [],
	number: "",
});

/** What `/` means: English, no other axes, no collector number. */
export const DEFAULT_FILTERS: BinderFilters = Object.freeze({
	...NO_FILTERS,
	language: [DEFAULT_LANGUAGE],
});

/** The two answers `ownedCopies` can give. Same vocabulary the cell treatment uses. */
export const STATE_VALUES = ["owned", "needed"] as const;

/** The 0–3 rungs, as strings. Derived from the shared scale so the range lives in one place. */
export const PRIORITY_VALUES: readonly string[] = PRIORITY_LEVELS.map(String);

/**
 * The axes whose values are a closed set, and are therefore validated rather than believed.
 *
 * The rest are open on purpose. The corpus canonicaliser reports axis values it could not place
 * and keeps them, so a `foil` nobody has seen yet is a real value; and a set that was renamed or
 * a language that has not synced yet is a *stale* selection, not a malformed one. A stale value
 * is kept and simply matches nothing, so the URL still describes what the owner asked for. A
 * priority of `7` is not on the scale at all, and is dropped.
 */
const CLOSED_VOCABULARIES: Partial<Record<FilterAxis, readonly string[]>> = {
	state: STATE_VALUES,
	priority: PRIORITY_VALUES,
};

/**
 * One axis' worth of URL, normalised — and this is the function that must not throw.
 *
 * The URL is user-editable and is also whatever was bookmarked three months ago, so every shape
 * that can arrive is handled and anything unrecognised becomes nothing:
 *
 * - a JSON array, which is what the router's own stringifier writes for a multi-select;
 * - a bare scalar — `?language=ja` typed by hand is a one-value selection, not a mistake;
 * - a number, because the query decoder turns `?priority=3` into `3` before this ever sees it;
 * - a repeated key, which that same decoder collects into a list;
 * - anything else — an object, a boolean, `null` — which is dropped rather than coerced.
 *
 * Deduplicated and sorted, so the same selection always produces the same URL and toggling a chip
 * off and on again does not rewrite the address bar.
 */
function axisValues(raw: unknown, vocabulary: readonly string[] | undefined): readonly string[] {
	const candidates: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
	const kept = new Set<string>();

	for (const candidate of candidates) {
		const value =
			typeof candidate === "string"
				? candidate.trim()
				: typeof candidate === "number" && Number.isFinite(candidate)
					? String(candidate)
					: "";
		if (value === "") continue;
		if (vocabulary !== undefined && !vocabulary.includes(value)) continue;
		kept.add(value);
	}

	return [...kept].sort();
}

function readCardNumber(raw: unknown): string {
	if (typeof raw === "string") return raw.trim();
	if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
	return "";
}

function isDefaultEnglish(language: readonly string[]): boolean {
	return language.length === 1 && language[0] === DEFAULT_LANGUAGE;
}

function normalise(source: Partial<Record<FilterAxis, unknown>>): BinderSearch {
	const search: { -readonly [K in FilterAxis]?: readonly string[] } = {};
	for (const axis of FILTER_AXES) {
		const values = axisValues(source[axis], CLOSED_VOCABULARIES[axis]);
		if (values.length > 0) search[axis] = values;
	}
	return search;
}

/**
 * The route's `validateSearch`. **Total: it answers every input and throws on none of them.**
 *
 * A malformed or stale URL must not take the binder down with it. Anything this cannot read
 * becomes an unselected axis, which is the state the owner can always recover from — the grid
 * renders, and the filter sheet shows what did survive.
 *
 * Unknown parameters are dropped rather than carried, so the next filter change also tidies the
 * URL up.
 */
export function parseBinderSearch(raw: Record<string, unknown>): BinderSearch {
	const search: { -readonly [K in keyof BinderSearch]?: BinderSearch[K] } = normalise(raw);

	if (!("language" in raw)) {
		search.language = [DEFAULT_LANGUAGE];
	} else {
		search.language = axisValues(raw.language, CLOSED_VOCABULARIES.language);
	}

	const number = readCardNumber(raw.number);
	if (number !== "") search.number = number;

	return search;
}

/** The URL form of a selection — the same normalisation, so parse ∘ stringify is a fixed point. */
export function searchFromFilters(filters: BinderFilters): BinderSearch {
	const search: { -readonly [K in keyof BinderSearch]?: BinderSearch[K] } = normalise(filters);
	const language = axisValues(filters.language, CLOSED_VOCABULARIES.language);

	// Default English is omitted so `/` stays `/`. Every other language selection is written,
	// including the empty list that means "all languages". `normalise` already copied a
	// non-empty language, so the default has to be taken back off rather than skipped.
	if (isDefaultEnglish(language)) delete search.language;
	else search.language = language;

	const number = filters.number.trim();
	if (number !== "") search.number = number;

	return search;
}

/**
 * The total form, for the predicate and the sheet. Missing axes become empty selections.
 *
 * **It normalises again rather than trusting `validateSearch`, and that is not belt-and-braces.**
 * TanStack Router validates per *matched route* and merges each route's result over its parent's.
 * The root route has no validator, so the raw parsed query rides through underneath, and a
 * parameter this route's validator rejected is still in the object the component reads:
 * `?priority=7&state=needed` arrives as `{ priority: 7, state: ["needed"] }` — one axis
 * validated, one still the number the URL carried.
 *
 * Found by opening that URL in a browser, where `7.some is not a function` replaced the binder
 * with the router's error page. Normalising here is what makes the component's input a
 * `BinderFilters` whatever route above it did or did not look at the query.
 */
export function filtersFromSearch(search: Record<string, unknown>): BinderFilters {
	const clean = parseBinderSearch(search);
	return {
		state: clean.state ?? [],
		priority: clean.priority ?? [],
		language: clean.language ?? [DEFAULT_LANGUAGE],
		finish: clean.finish ?? [],
		subtype: clean.subtype ?? [],
		stamps: clean.stamps ?? [],
		foil: clean.foil ?? [],
		set: clean.set ?? [],
		number: clean.number ?? "",
	};
}

/** How many axes are narrowing the grid. What the bar's `filters · 3` counts. */
export function activeFilterCount(filters: BinderFilters): number {
	const axes = FILTER_AXES.filter((axis) => filters[axis].length > 0).length;
	return axes + (filters.number.trim() === "" ? 0 : 1);
}

/**
 * Axes the owner chose on top of the default English view. The bar's count and the clear
 * button both use this, so `/` does not open already saying `filters · 1`.
 */
export function extraFilterCount(filters: BinderFilters): number {
	let count = 0;
	if (filters.number.trim() !== "") count += 1;
	for (const axis of FILTER_AXES) {
		if (axis === "language") {
			if (!isDefaultEnglish(filters.language)) count += 1;
			continue;
		}
		if (filters[axis].length > 0) count += 1;
	}
	return count;
}

export function isDefaultFilters(filters: BinderFilters): boolean {
	return extraFilterCount(filters) === 0 && isDefaultEnglish(filters.language);
}

export function hasActiveFilters(filters: BinderFilters): boolean {
	return activeFilterCount(filters) > 0;
}

/** Add a value to an axis, or take it out again. The only way the sheet changes a selection. */
export function toggleFilterValue(
	filters: BinderFilters,
	axis: FilterAxis,
	value: string,
): BinderFilters {
	const current = filters[axis];
	const next = current.includes(value)
		? current.filter((held) => held !== value)
		: [...current, value];
	return { ...filters, [axis]: next };
}

/** Replace an axis outright. The `needed` shortcut in the bar is one of these, not a toggle loop. */
export function setFilterAxis(
	filters: BinderFilters,
	axis: FilterAxis,
	values: readonly string[],
): BinderFilters {
	return { ...filters, [axis]: values };
}

export function setFilterNumber(filters: BinderFilters, number: string): BinderFilters {
	return { ...filters, number };
}

/**
 * What one entry carries on one axis — always a list, even where the schema says scalar.
 *
 * **`stamps` is a list and the others are not**, and the difference is the whole reason this
 * exists. A variant may carry `1st-edition` *and* `set-logo`; a filter over it is a membership
 * test, never an equality test. Lifting the scalars into one-element lists makes every axis the
 * same membership test, so there is one rule to read and one rule to get right.
 *
 * An axis upstream never set contributes an empty list, so it matches no selection at all — which
 * is correct: a variant with no `foil` is not a variant with the `foil` you asked for.
 */
function carriedValues(entry: BinderEntry, axis: FilterAxis): readonly string[] {
	switch (axis) {
		case "state":
			return [entry.ownedCopies > 0 ? "owned" : "needed"];
		case "priority":
			// The one place a rung crosses between its number on the entry and its string in the URL.
			return entry.priority === null ? [] : [String(entry.priority)];
		case "language":
			return [entry.language];
		case "finish":
			return entry.finish === null ? [] : [entry.finish];
		case "subtype":
			return entry.subtype === null ? [] : [entry.subtype];
		case "stamps":
			return entry.stamps;
		case "foil":
			return entry.foil === null ? [] : [entry.foil];
		case "set":
			// The set **id**, not the `(language, set)` pair the corpus keys on. `base2` is Jungle in
			// six languages and language is its own axis, so filtering by the pair would make every
			// set selection a hidden language selection as well.
			return [entry.setId];
	}
}

/**
 * Whether a printed collector number is the one the owner typed.
 *
 * Exact on the printed string (so `SH3` and `H31` stay themselves), and also on the stem
 * before a slash (`198/165`) and on the leading digits with zeros stripped (`002` vs `2`).
 * A substring is not enough: `198` must not pull in `1198`.
 */
export function matchesCardNumber(localId: string, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;

	const printed = localId.trim().toLowerCase();
	if (printed === needle) return true;

	const stem = printed.split("/")[0] ?? printed;
	if (stem === needle) return true;

	if (!/^\d+$/.test(needle)) return false;
	const digits = stem.match(/^(\d+)/);
	if (digits === null) return false;
	return stripLeadingZeros(digits[1] ?? "") === stripLeadingZeros(needle);
}

function stripLeadingZeros(value: string): string {
	const stripped = value.replace(/^0+/, "");
	return stripped === "" ? "0" : stripped;
}

/**
 * The predicate. **OR within an axis, AND across axes**, and the shape says so:
 * `every` over the axes is the AND, `some` over the selection is the OR.
 *
 * The collector number sits outside the axes and is always AND: typing `198` with EN on
 * shows English 198s, not every 198 plus every English card.
 */
export function matchesFilters(entry: BinderEntry, filters: BinderFilters): boolean {
	if (!matchesCardNumber(entry.localId, filters.number)) return false;

	return FILTER_AXES.every((axis) => {
		const selected = filters[axis];
		// An axis with nothing selected narrows nothing. Not "matches everything" by accident —
		// this is the line that makes an unfiltered binder the whole binder.
		if (selected.length === 0) return true;

		const carried = carriedValues(entry, axis);
		return selected.some((value) => carried.includes(value));
	});
}

/**
 * The visible entries.
 *
 * Returns the input array itself when nothing is selected, so an unfiltered binder does not copy
 * 817 entries on every render — and so the virtualiser sees the same identity it saw before.
 */
export function filterEntries(
	entries: readonly BinderEntry[],
	filters: BinderFilters,
): readonly BinderEntry[] {
	if (!hasActiveFilters(filters)) return entries;
	return entries.filter((entry) => matchesFilters(entry, filters));
}

export interface FilterOption {
	readonly value: string;
	/** What the chip says. The value itself for most axes; a set's name for `set`. */
	readonly label: string;
}

export type FilterFacets = Readonly<Record<FilterAxis, readonly FilterOption[]>>;

/**
 * The options each axis offers, **read off the document rather than hard-coded**.
 *
 * Two axes are closed scales and are always offered: owned/needed, and the 0–3 priority rungs. A
 * priority the owner has not used yet still has to be selectable, or the dial is invisible until
 * after it is turned.
 *
 * The other six are open. The corpus canonicalises upstream's localised axis strings and keeps
 * what it could not place, so a hard-coded list would hide exactly the values worth looking at —
 * and would offer options that match nothing, which is worse than offering none.
 *
 * Deliberately carries **no counts**. A tally of needed cards is the completion figure wearing a
 * different hat, and how completion is presented is still undecided in the spec.
 */
export function filterFacets(entries: readonly BinderEntry[]): FilterFacets {
	const language = new Set<string>();
	const finish = new Set<string>();
	const subtype = new Set<string>();
	const stamps = new Set<string>();
	const foil = new Set<string>();
	// A Map, so sets keep the order they appear in — the document is already ordered by release
	// date descending, so the set list reads in the same order as the grid it filters.
	const sets = new Map<string, string>();

	for (const entry of entries) {
		language.add(entry.language);
		if (entry.finish !== null) finish.add(entry.finish);
		if (entry.subtype !== null) subtype.add(entry.subtype);
		if (entry.foil !== null) foil.add(entry.foil);
		for (const stamp of entry.stamps) stamps.add(stamp);

		const known = sets.get(entry.setId);
		if (known === undefined || known === entry.setId) {
			sets.set(entry.setId, entry.setName ?? entry.setId);
		}
	}

	return {
		state: STATE_VALUES.map((value) => ({ value, label: value })),
		priority: PRIORITY_VALUES.map((value) => ({
			value,
			// The top rung is the one with a consequence attached, and the sheet is where the owner
			// finds that out — the notification policy pushes it instantly.
			label: value === String(MAX_PRIORITY) ? `${value} — instant` : value,
		})),
		language: sorted(language).map((value) => ({ value, label: value.toUpperCase() })),
		finish: sorted(finish).map(plain),
		subtype: sorted(subtype).map(plain),
		stamps: sorted(stamps).map(plain),
		foil: sorted(foil).map(plain),
		set: [...sets].map(([value, label]) => ({ value, label })),
	};
}

function sorted(values: Set<string>): readonly string[] {
	return [...values].sort();
}

function plain(value: string): FilterOption {
	return { value, label: value };
}
