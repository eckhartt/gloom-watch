/**
 * The listing feed. No matching, no queue, no price-as-current past six hours.
 *
 * A listing detail route has to resolve on a cold load — it is the notification tap target
 * once that ticket lands, and the service worker may have no warm state. The collection
 * itself is `/api/listings`; one item is `/api/listings/{itemId}`.
 */

import { Hono } from "hono";
import type { ListingDocument, ListingsDocument, Marketplace } from "../../shared/listings.ts";
import { LISTINGS_PATH, MARKETPLACES } from "../../shared/listings.ts";
import type { GloomDatabase } from "../db/client.ts";
import {
	FEED_PAGE_SIZE,
	readListing,
	readLocationFacets,
	readRecentListings,
} from "./repository.ts";

export interface ListingRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

const CACHE_CONTROL = "no-store";

export function createListingRoutes(deps: ListingRouteDeps): Hono {
	const routes = new Hono();

	routes.get(LISTINGS_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const rawMarkets = c.req.queries("marketplace") ?? [];
		const marketplaces = rawMarkets.filter((value): value is Marketplace =>
			(MARKETPLACES as readonly string[]).includes(value),
		);
		const locations = (c.req.queries("location") ?? []).filter((value) => value !== "");
		const body: ListingsDocument = {
			generatedAt: deps.now(),
			listings: readRecentListings(
				deps.db,
				deps.now(),
				FEED_PAGE_SIZE,
				marketplaces.length > 0 ? marketplaces : undefined,
				locations.length > 0 ? locations : undefined,
			),
			locations: readLocationFacets(deps.db, marketplaces.length > 0 ? marketplaces : undefined),
		};
		return c.json(body);
	});

	routes.get(`${LISTINGS_PATH}/:itemId`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const itemId = c.req.param("itemId");
		const listing: ListingDocument | null = readListing(deps.db, itemId, deps.now());
		if (listing === null) {
			return c.json({ error: "listing not found" }, 404);
		}
		return c.json(listing);
	});

	return routes;
}
