import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
	createIDBPersister,
	installBrowserOutbox,
	persistDehydrateOptions,
} from "./outbox-browser.ts";
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
			// Long enough that a binder painted optimistically while offline is still here after
			// a reload. The persist plugin is what actually keeps it; this stops gc from racing it.
			gcTime: 1000 * 60 * 60 * 24,
		},
		mutations: {
			// Default `"online"` would pause the mutationFn the moment the browser fires `offline`,
			// and never enqueue. `"offlineFirst"` runs it; a failed fetch is what the outbox catches.
			networkMode: "offlineFirst",
		},
	},
});

installBrowserOutbox(queryClient);

const rootElement = document.getElementById("root");
if (rootElement === null) {
	throw new Error("index.html is missing #root");
}

createRoot(rootElement).render(
	<StrictMode>
		<PersistQueryClientProvider
			client={queryClient}
			persistOptions={{
				persister: createIDBPersister(),
				maxAge: 1000 * 60 * 60 * 24,
				buster: "outbox-v1",
				dehydrateOptions: persistDehydrateOptions(),
			}}
		>
			<RouterProvider router={router} />
		</PersistQueryClientProvider>
	</StrictMode>,
);

registerServiceWorker();
