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
import type { BinderDocument, BinderEntry } from "../shared/contract.ts";
import type { CompletionDocument, CopyDocument } from "../shared/copies.ts";
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

/** The owner-authored exclusion list. A corpus re-import never writes it; this cache is ours. */
export const EXCLUSIONS_QUERY_KEY = ["corpus-exclusions"] as const;

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
export type CollectionEvent = "copy-write" | "corpus-sync" | "manual-write";

export function queryKeysInvalidatedBy(event: CollectionEvent): readonly (readonly string[])[] {
	if (event === "corpus-sync") {
		return [BINDER_QUERY_KEY, COMPLETION_QUERY_KEY, CORPUS_STATUS_QUERY_KEY];
	}
	if (event === "manual-write") {
		// A hand-added row changes the denominator and the binder; an exclusion write changes
		// what the next sync will ingest, which is why the list itself is in this set too.
		return [BINDER_QUERY_KEY, COMPLETION_QUERY_KEY, CORPUS_STATUS_QUERY_KEY, EXCLUSIONS_QUERY_KEY];
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
 * **Minted here, on the client, because that is what makes the outbox's replay idempotent**: a
 * create whose response was lost replays into the same row rather than into a second card. The
 * server refuses anything that is not UUID-shaped, so a fallback that produced something else
 * would fail at the boundary rather than quietly.
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

/* -------------------------------------------------------------------------- */
/* Optimistic cache                                                            */
/* -------------------------------------------------------------------------- */

function patchBinderEntry(
	doc: BinderDocument,
	cardKey: string,
	variantId: string,
	patch: (entry: BinderEntry) => BinderEntry,
): BinderDocument {
	return {
		...doc,
		entries: doc.entries.map((entry) =>
			entry.cardKey === cardKey && entry.variantId === variantId ? patch(entry) : entry,
		),
	};
}

/** The cell flips from needed to owned the moment the owner records the card, tunnel or not. */
export function applyCopyCreateToBinder(
	doc: BinderDocument,
	cardKey: string,
	variantId: string,
): BinderDocument {
	return patchBinderEntry(doc, cardKey, variantId, (entry) => ({
		...entry,
		ownedCopies: entry.ownedCopies + 1,
	}));
}

export function applyCopyDisposeToBinder(
	doc: BinderDocument,
	cardKey: string,
	variantId: string,
): BinderDocument {
	return patchBinderEntry(doc, cardKey, variantId, (entry) => ({
		...entry,
		ownedCopies: Math.max(0, entry.ownedCopies - 1),
	}));
}

export function applyPriorityToBinder(
	doc: BinderDocument,
	cardKey: string,
	variantId: string,
	priority: number | null,
): BinderDocument {
	return patchBinderEntry(doc, cardKey, variantId, (entry) => ({ ...entry, priority }));
}

/**
 * Completion moves with the first owned copy of a variant, not with every copy. A second NM of
 * the same printing does not raise the numerator.
 *
 * A `missing_upstream` variant that was unowned was out of the denominator; owning it brings
 * it back, per the rule the completion ticket pinned.
 */
export function applyCopyCreateToCompletion(
	completion: CompletionDocument,
	entry: Pick<BinderEntry, "ownedCopies" | "missingUpstream"> | undefined,
): CompletionDocument {
	if (entry === undefined || entry.ownedCopies > 0) return completion;
	return {
		owned: completion.owned + 1,
		total: entry.missingUpstream ? completion.total + 1 : completion.total,
		missingUpstreamExcluded: entry.missingUpstream
			? Math.max(0, completion.missingUpstreamExcluded - 1)
			: completion.missingUpstreamExcluded,
	};
}

export function applyCopyDisposeToCompletion(
	completion: CompletionDocument,
	entry: Pick<BinderEntry, "ownedCopies" | "missingUpstream"> | undefined,
): CompletionDocument {
	if (entry === undefined || entry.ownedCopies !== 1) return completion;
	return {
		owned: Math.max(0, completion.owned - 1),
		total: entry.missingUpstream ? Math.max(0, completion.total - 1) : completion.total,
		missingUpstreamExcluded: entry.missingUpstream
			? completion.missingUpstreamExcluded + 1
			: completion.missingUpstreamExcluded,
	};
}

export function applyOptimisticCopyCreate(queryClient: QueryClient, copy: CopyDocument): void {
	const copiesKey = variantCopiesQueryKey(copy.cardKey, copy.variantId);
	queryClient.setQueryData<readonly CopyDocument[]>(copiesKey, (held) => [...(held ?? []), copy]);

	const binder = queryClient.getQueryData<BinderDocument>(BINDER_QUERY_KEY);
	const entry = binder?.entries.find(
		(item) => item.cardKey === copy.cardKey && item.variantId === copy.variantId,
	);
	if (binder !== undefined) {
		queryClient.setQueryData(
			BINDER_QUERY_KEY,
			applyCopyCreateToBinder(binder, copy.cardKey, copy.variantId),
		);
	}
	queryClient.setQueryData<CompletionDocument>(COMPLETION_QUERY_KEY, (current) =>
		current === undefined ? current : applyCopyCreateToCompletion(current, entry),
	);
}

export function applyOptimisticCopyUpdate(queryClient: QueryClient, copy: CopyDocument): void {
	const copiesKey = variantCopiesQueryKey(copy.cardKey, copy.variantId);
	queryClient.setQueryData<readonly CopyDocument[]>(copiesKey, (held) =>
		(held ?? []).map((item) => (item.id === copy.id ? copy : item)),
	);
}

export function applyOptimisticCopyDispose(queryClient: QueryClient, copy: CopyDocument): void {
	const copiesKey = variantCopiesQueryKey(copy.cardKey, copy.variantId);
	queryClient.setQueryData<readonly CopyDocument[]>(copiesKey, (held) =>
		(held ?? []).map((item) => (item.id === copy.id ? copy : item)),
	);

	const binder = queryClient.getQueryData<BinderDocument>(BINDER_QUERY_KEY);
	const entry = binder?.entries.find(
		(item) => item.cardKey === copy.cardKey && item.variantId === copy.variantId,
	);
	if (binder !== undefined) {
		queryClient.setQueryData(
			BINDER_QUERY_KEY,
			applyCopyDisposeToBinder(binder, copy.cardKey, copy.variantId),
		);
	}
	queryClient.setQueryData<CompletionDocument>(COMPLETION_QUERY_KEY, (current) =>
		current === undefined ? current : applyCopyDisposeToCompletion(current, entry),
	);
}

export function applyOptimisticPriority(
	queryClient: QueryClient,
	cardKey: string,
	variantId: string,
	priority: number | null,
): void {
	const binder = queryClient.getQueryData<BinderDocument>(BINDER_QUERY_KEY);
	if (binder === undefined) return;
	queryClient.setQueryData(
		BINDER_QUERY_KEY,
		applyPriorityToBinder(binder, cardKey, variantId, priority),
	);
}
