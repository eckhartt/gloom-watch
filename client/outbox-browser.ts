/**
 * Browser wiring for the outbox: IndexedDB via `idb-keyval`, TanStack Query's persist plugin
 * for the optimistic cache, and `fetch` as the replay transport.
 *
 * The queue itself is `shared/outbox.ts`. This file is the adapter the page process uses; tests
 * never import it, so they can drive the same replay against Hono without a DOM.
 */

import type { DehydrateOptions, QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import {
	createOutboxStore,
	createTransport,
	setDefaultOutboxStore,
	startOutboxPump,
} from "../shared/outbox.ts";
import { BINDER_QUERY_KEY, COMPLETION_QUERY_KEY } from "./collection.ts";

const PERSIST_KEY = "gloom-watch:query-cache";

/** The official IndexedDB persister from TanStack Query's persist-client docs, via `idb-keyval`. */
export function createIDBPersister(idbValidKey: IDBValidKey = PERSIST_KEY): Persister {
	return {
		persistClient: async (client: PersistedClient) => {
			await set(idbValidKey, client);
		},
		restoreClient: async () => {
			return await get<PersistedClient>(idbValidKey);
		},
		removeClient: async () => {
			await del(idbValidKey);
		},
	};
}

export function createIndexedDbKv(): {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	del(key: string): Promise<void>;
} {
	return {
		get: (key) => get(key),
		set: (key, value) => set(key, value),
		del: (key) => del(key),
	};
}

/**
 * Persist the binder, completion and per-variant copy lists. Those are the documents the
 * optimistic writes paint, and they have to survive a reload while the outbox is still
 * waiting to drain. Mutations themselves are **not** dehydrated — the outbox is the write
 * queue, and persisting paused mutations alongside it would replay twice.
 */
export function persistDehydrateOptions(): DehydrateOptions {
	return {
		shouldDehydrateQuery: (query) => {
			const root = query.queryKey[0];
			return root === "binder" || root === "completion" || root === "copies";
		},
		shouldDehydrateMutation: () => false,
	};
}

export function installBrowserOutbox(queryClient: QueryClient): () => void {
	const store = createOutboxStore(createIndexedDbKv());
	setDefaultOutboxStore(store);
	const pump = startOutboxPump({
		store,
		transport: createTransport(fetch),
		onDrained: () => {
			void queryClient.invalidateQueries({ queryKey: BINDER_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: COMPLETION_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ["copies"] });
		},
	});

	// A successful binder fetch is proof the tunnel is back, even when `navigator.onLine` never
	// flipped — the realistic tailnet-drop case. Drain then, not only on the `online` event.
	const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
		if (event.type !== "updated") return;
		if (event.query.queryKey[0] !== "binder") return;
		if (event.query.state.status !== "success") return;
		if (event.query.state.fetchStatus !== "idle") return;
		void store.pendingCount().then((count) => {
			if (count > 0) void pump.drain();
		});
	});

	return () => {
		pump.stop();
		unsubscribe();
	};
}
