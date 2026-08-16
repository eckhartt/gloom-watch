import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { HomeScreen } from "./routes/home.tsx";

/**
 * Code-based routing rather than file-based: no generated `routeTree.gen.ts` to keep in sync,
 * and typed URL search parameters — which the binder's filter state needs — work identically
 * either way.
 */

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: HomeScreen,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
