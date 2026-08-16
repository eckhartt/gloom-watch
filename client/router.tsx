import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { BinderScreen } from "./routes/binder.tsx";
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
 * There are two routes and the variant sheet is neither of them. Tapping a card must not
 * navigate — the binder stays as context and the scroll position with it — so the sheet is
 * component state, not a route.
 */

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: BinderScreen,
});

const statusRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/status",
	component: HomeScreen,
});

const routeTree = rootRoute.addChildren([indexRoute, statusRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
