/**
 * Collection writes, with the outbox as the fallback when the tailnet is down.
 *
 * Try the server first. A validation error is the owner's to correct and is not queued. A
 * dropped connection is queued and the caller gets an optimistic document so the grid can
 * move *now* rather than after the tunnel returns.
 *
 * Photographs never enter this path. `attemptPhotoUpload` holds them aside.
 */

import type {
	CopyCreateRequest,
	CopyDisposalRequest,
	CopyDocument,
	CopyPatchRequest,
	PriorityDocument,
	PriorityRequest,
} from "../shared/copies.ts";
import {
	aliasCreateMutation,
	copyCreateMutation,
	copyDisposeMutation,
	copyUpdateMutation,
	enqueue,
	getDefaultOutboxStore,
	holdPhotoAttempt,
	isNetworkFailure,
	matchConfirmMutation,
	type OutboxMutation,
	type OutboxStore,
	optimisticCopyDocument,
	type PhotoHold,
	priorityMutation,
} from "../shared/outbox.ts";
import {
	confirmListing,
	createAlias,
	createCopy,
	disposeCopy,
	setVariantPriority,
	updateCopy,
} from "./api.ts";

export interface WriteResult<T> {
	readonly queued: boolean;
	readonly value: T;
}

export interface WriteDeps {
	readonly store?: OutboxStore;
	readonly now?: () => number;
}

function storeOf(deps: WriteDeps): OutboxStore {
	return deps.store ?? getDefaultOutboxStore();
}

async function attempt<T>(
	send: () => Promise<T>,
	mutation: OutboxMutation,
	fallback: T,
	deps: WriteDeps,
): Promise<WriteResult<T>> {
	try {
		return { queued: false, value: await send() };
	} catch (error) {
		if (!isNetworkFailure(error)) throw error;
		await enqueue(storeOf(deps), mutation);
		return { queued: true, value: fallback };
	}
}

export function writeCopyCreate(
	request: CopyCreateRequest,
	deps: WriteDeps = {},
): Promise<WriteResult<CopyDocument>> {
	return attempt(
		() => createCopy(request),
		copyCreateMutation(request),
		optimisticCopyDocument(request, deps.now?.() ?? Date.now()),
		deps,
	);
}

export function writeCopyUpdate(
	id: string,
	patch: CopyPatchRequest,
	previous: CopyDocument,
	deps: WriteDeps = {},
): Promise<WriteResult<CopyDocument>> {
	const fallback: CopyDocument = {
		...previous,
		...patch,
		id: previous.id,
		cardKey: previous.cardKey,
		variantId: previous.variantId,
		status: previous.status,
		disposedAt: previous.disposedAt,
		disposalKind: previous.disposalKind,
		createdAt: previous.createdAt,
		updatedAt: deps.now?.() ?? Date.now(),
	};
	return attempt(() => updateCopy(id, patch), copyUpdateMutation(id, patch), fallback, deps);
}

export function writeCopyDispose(
	id: string,
	request: CopyDisposalRequest,
	previous: CopyDocument,
	deps: WriteDeps = {},
): Promise<WriteResult<CopyDocument>> {
	const fallback: CopyDocument = {
		...previous,
		status: "disposed",
		disposedAt: request.disposedAt,
		disposalKind: request.disposalKind ?? previous.disposalKind,
		note:
			request.note !== undefined && request.note !== null && request.note !== ""
				? previous.note === null || previous.note === ""
					? request.note
					: `${previous.note}\n${request.note}`
				: previous.note,
		updatedAt: deps.now?.() ?? Date.now(),
	};
	return attempt(() => disposeCopy(id, request), copyDisposeMutation(id, request), fallback, deps);
}

export function writePriority(
	request: PriorityRequest,
	deps: WriteDeps = {},
): Promise<WriteResult<PriorityDocument>> {
	const fallback: PriorityDocument = {
		cardKey: request.cardKey,
		variantId: request.variantId,
		priority: request.priority,
	};
	return attempt(() => setVariantPriority(request), priorityMutation(request), fallback, deps);
}

export function writeMatchConfirm(
	itemId: string,
	body: unknown,
	deps: WriteDeps = {},
): Promise<WriteResult<unknown>> {
	return attempt(
		() => confirmListing(itemId, body),
		matchConfirmMutation(itemId, body),
		body,
		deps,
	);
}

export function writeAliasCreate(
	body: { readonly id: string } & Record<string, unknown>,
	deps: WriteDeps = {},
): Promise<WriteResult<unknown>> {
	return attempt(() => createAlias(body), aliasCreateMutation(body), body, deps);
}

/**
 * Attempt a photograph. Never queues the blob.
 *
 * Offline: hold metadata and surface a pending state. Online: there is no processor yet, so
 * the attempt is deferred rather than invented.
 */
export async function attemptPhotoUpload(
	copyId: string,
	options: { readonly store?: OutboxStore; readonly online?: boolean } = {},
): Promise<{ status: "held"; hold: PhotoHold } | { status: "deferred" }> {
	const online = options.online ?? (typeof navigator === "undefined" ? true : navigator.onLine);
	if (online) return { status: "deferred" };
	const hold = await holdPhotoAttempt(options.store ?? getDefaultOutboxStore(), copyId);
	return { status: "held", hold };
}
