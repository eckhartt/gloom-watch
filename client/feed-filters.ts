import { MARKETPLACES, type Marketplace } from "../shared/listings.ts";

/**
 * Feed filter state in the URL. Empty `marketplace` means every market — the chips then
 * show none on. AU is first in `MARKETPLACES` because it is home.
 */

export interface FeedSearch {
	readonly marketplace: readonly Marketplace[];
}

export const NO_FEED_FILTERS: FeedSearch = { marketplace: [] };

function asList(value: unknown): string[] {
	if (value === undefined || value === null || value === "") return [];
	if (Array.isArray(value)) return value.map(String);
	return [String(value)];
}

export function parseFeedSearch(search: Record<string, unknown>): FeedSearch {
	const marketplace = asList(search.marketplace).filter((value): value is Marketplace =>
		(MARKETPLACES as readonly string[]).includes(value),
	);
	return { marketplace };
}

export function searchFromFeed(filters: FeedSearch): FeedSearch {
	return { marketplace: [...filters.marketplace] };
}

export function toggleMarketplace(filters: FeedSearch, marketplace: Marketplace): FeedSearch {
	const has = filters.marketplace.includes(marketplace);
	return {
		marketplace: has
			? filters.marketplace.filter((value) => value !== marketplace)
			: [...filters.marketplace, marketplace],
	};
}
