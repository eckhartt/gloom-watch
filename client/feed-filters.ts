import { HOME_LOCATION_COUNTRY } from "../shared/listings.ts";

/**
 * Feed filter state in the URL. Empty `location` means every country. A missing
 * `location` key defaults to AU — home — so `/feed` is local stock, not every
 * US seller shipping to eBay AU.
 */

export interface FeedSearch {
	readonly location: readonly string[];
}

export const NO_FEED_FILTERS: FeedSearch = { location: [HOME_LOCATION_COUNTRY] };

function asList(value: unknown): string[] {
	if (value === undefined || value === null || value === "") return [];
	if (Array.isArray(value)) return value.map(String);
	return [String(value)];
}

export function parseFeedSearch(search: Record<string, unknown>): FeedSearch {
	if (!("location" in search)) {
		return { location: [HOME_LOCATION_COUNTRY] };
	}
	const location = asList(search.location)
		.map((value) => value.trim().toUpperCase())
		.filter((value) => /^[A-Z]{2}$/.test(value));
	return { location };
}

export function searchFromFeed(filters: FeedSearch): FeedSearch {
	return { location: [...filters.location] };
}

export function toggleLocation(filters: FeedSearch, country: string): FeedSearch {
	const has = filters.location.includes(country);
	return {
		location: has
			? filters.location.filter((value) => value !== country)
			: [...filters.location, country],
	};
}
