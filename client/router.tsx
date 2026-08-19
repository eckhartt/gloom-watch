import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { parseBinderSearch } from "./binder/filters.ts";
import { parseFeedSearch } from "./feed-filters.ts";
import { BinderScreen } from "./routes/binder.tsx";
import { FeedScreen, ListingDetailScreen } from "./routes/feed.tsx";
import { HomeScreen } from "./routes/home.tsx";

/**
 * Code-based routing rather than file-based: no generated `routeTree.gen.ts` to keep in sync,
 * and typed URL search parameters — which the binder's filter state needs — work identically
 * either way.
 *
 * **The binder is `/`, because the binder is the app.** Seeing the collection and its holes is
 * meant to be the default act of opening it, not something reached from a menu. Health, the
 * corpus sync and the notification controls moved to `/status`, which is where an owner goes to
 * find out why something is wrong rather than to look at cards.
 *
 * There are **still two routes**, and neither the variant sheet nor the filters is one of them.
 * Tapping a card must not navigate — the binder stays as context and the scroll position with
 * it — so the sheet is component state. And **the Gap is a filter, not a screen**: "what I still
 * need" is a selection on `/`, never a page of its own, so the owner never loses the binder to
 * look at their holes.
 */

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: BinderScreen,
	/**
	 * The binder's filter state, typed, so a filtered view survives a reload and can be returned
	 * to.
	 *
	 * `parseBinderSearch` is **total** — every input has an answer and none of them is a throw.
	 * A `validateSearch` that threw would take the binder down for a URL somebody hand-edited or
	 * bookmarked three months ago, which is precisely the URL this route has to survive.
	 */
	validateSearch: parseBinderSearch,
});

const statusRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/status",
	component: HomeScreen,
});

const feedRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/feed",
	component: FeedScreen,
	validateSearch: parseFeedSearch,
});

const listingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/feed/$itemId",
	component: ListingDetailScreen,
});

const routeTree = rootRoute.addChildren([indexRoute, statusRoute, feedRoute, listingRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
