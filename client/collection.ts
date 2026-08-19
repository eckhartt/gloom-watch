/**
 * Which cached queries a write falsifies, and therefore which ones must be thrown away.
 *
 * **The spec's rule is "invalidate any cached figure on corpus sync and on copy creation or
 * disposal".** The server keeps no such figure — completion is computed per request, precisely so
 * that a sync running in a *different OS process* cannot leave a stale one behind. The caches that
 * do exist are here, in the client's query cache, so this is where invalidation is a real act
 * rather than a gesture.
 *
 * Kept as a function of the event rather than as a call site in each mutation, because the
 * dangerous version of this mistake is the *quiet* one: recording a copy and invalidating only the
 * list it came from leaves the binder showing the card as needed and completion showing the number
 * before. Both surfaces then agree with each other and disagree with the database.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { BinderDocument } from "../shared/contract.ts";
import { fetchBinder } from "./api.ts";

/** The whole masterset with its ownership state. Its ETag changes when a copy is recorded. */
export const BINDER_QUERY_KEY = ["binder"] as const;

/**
 * How the binder document is fetched, in one place, because **two screens want it and one of
 * them has to work with no connection.**
 *
 * `networkMode: "offlineFirst"` is the load-bearing option and it is not a preference.
 * TanStack Query's default mode is `"online"`, which **does not run the query function at all**
 * while the client believes it is offline — and the client believes that the moment the browser
 * fires an `offline` event, which aeroplane mode does. The request would never be made, the
 * service worker would never be asked, and the binder the phone is holding in its cache would
 * sit there behind a spinner. `"offlineFirst"` runs the fetch once regardless and only *then*
 * pauses retries, which is exactly the shape a `NetworkFirst` service-worker cache needs: the
 * fetch is answered from the cache and the grid renders with the tailnet unreachable.
 *
 * `staleTime` is a minute because the masterset changes only when the owner presses sync or
 * records a copy, and both of those invalidate this key by hand. Polling a ~290 KB document on a
 * timer would burn battery to learn nothing.
 */
export function binderQueryOptions(): {
	queryKey: typeof BINDER_QUERY_KEY;
	queryFn: (context: { signal: AbortSignal }) => Promise<BinderDocument>;
	staleTime: number;
	networkMode: "offlineFirst";
} {
	return {
		queryKey: BINDER_QUERY_KEY,
		queryFn: ({ signal }) => fetchBinder(signal),
		staleTime: 60_000,
		networkMode: "offlineFirst",
	};
}

/** The numerator and the denominator. Both of them move, and not always in the same direction. */
export const COMPLETION_QUERY_KEY = ["completion"] as const;

/** Totals, last-synced and the running job. */
export const CORPUS_STATUS_QUERY_KEY = ["corpus-status"] as const;

/** One variant's copies, disposed included. Keyed on the composite identity, never on the variant. */
export function variantCopiesQueryKey(cardKey: string, variantId: string): readonly string[] {
	return ["copies", cardKey, variantId];
}

/** One copy's photographs. Keyed on the copy, because that is what they attach to. */
export function copyPhotographsQueryKey(copyId: string): readonly string[] {
	return ["photographs", copyId];
}

/**
 * The two events the spec names, and everything each one falsifies.
 *
 * `corpus-sync` invalidates completion because the **denominator is not constant**: a sync that
 * picks up a new language or a new printing makes the masterset bigger, and completion goes
 * *down*. That is correct for a masterset and it is exactly the case a client holding yesterday's
 * figure would get wrong.
 */
export type CollectionEvent = "copy-write" | "corpus-sync";

export function queryKeysInvalidatedBy(event: CollectionEvent): readonly (readonly string[])[] {
	if (event === "corpus-sync") {
		return [BINDER_QUERY_KEY, COMPLETION_QUERY_KEY, CORPUS_STATUS_QUERY_KEY];
	}
	return [BINDER_QUERY_KEY, COMPLETION_QUERY_KEY];
}

/** Throw away everything the event falsified. Fire and forget; a refetch is not worth awaiting. */
export function invalidateAfter(queryClient: QueryClient, event: CollectionEvent): void {
	for (const queryKey of queryKeysInvalidatedBy(event)) {
		void queryClient.invalidateQueries({ queryKey });
	}
}

/**
 * The identifier for a copy the owner is about to record.
 *
 * **Minted here, on the client, because that is what makes the outbox's replay idempotent** in a
 * later ticket: a create whose response was lost replays into the same row rather than into a
 * second card. The server refuses anything that is not UUID-shaped, so a fallback that produced
 * something else would fail at the boundary rather than quietly.
 *
 * `crypto.randomUUID` needs a secure context, which the deployed origin (HTTPS over Tailscale
 * Serve) and `localhost` both are — but plain HTTP to the box's LAN address is not, and that is a
 * real way to open this app while debugging. `getRandomValues` is available either way, so the
 * fallback composes a v4 by hand rather than leaving the button broken.
 */
export function newCopyId(): string {
	return newClientUuid();
}

/** Same minting as a copy id — photographs are client-authored rows too. */
export function newPhotographId(): string {
	return newClientUuid();
}

function newClientUuid(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

	const bytes = crypto.getRandomValues(new Uint8Array(16));
	// Version 4, variant 10xx — the two fields that make it a well-formed v4 rather than 16 random
	// bytes wearing hyphens.
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
