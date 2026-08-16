import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerServiceWorker } from "./pwa.ts";
import { router } from "./router.tsx";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// The tailnet drops out; retrying forever is noise, and the staleness banner is the
			// design's answer to silence.
			retry: 1,
			refetchOnWindowFocus: true,
		},
	},
});

const rootElement = document.getElementById("root");
if (rootElement === null) {
	throw new Error("index.html is missing #root");
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);

registerServiceWorker();
