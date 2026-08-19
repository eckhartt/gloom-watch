import type {
	BinderDocument,
	CorpusStatusDocument,
	CorpusSyncJobDocument,
	HealthDocument,
} from "../shared/contract.ts";
import {
	BINDER_PATH,
	CORPUS_STATUS_PATH,
	CORPUS_SYNC_PATH,
	corpusSyncJobPath,
	HEALTH_PATH,
} from "../shared/contract.ts";
import type {
	CompletionDocument,
	CopyCreateRequest,
	CopyDisposalRequest,
	CopyDocument,
	CopyListDocument,
	CopyPatchRequest,
	PriorityDocument,
	PriorityRequest,
} from "../shared/copies.ts";
import {
	COMPLETION_PATH,
	COPIES_PATH,
	copyDisposalPath,
	copyPath,
	PRIORITIES_PATH,
	variantCopiesPath,
} from "../shared/copies.ts";
import { UNLOCK_PATH } from "../shared/gate.ts";
import type { ListingDocument, ListingsDocument } from "../shared/listings.ts";
import { LISTINGS_PATH, listingPath } from "../shared/listings.ts";
import type {
	AliasCreateRequest,
	AliasDocument,
	AliasListDocument,
	AliasPatchRequest,
	QueueConfirmRequest,
	QueueDocument,
	QueuePickVariantRequest,
	QueueResolutionDocument,
} from "../shared/queue.ts";
import {
	ALIASES_PATH,
	aliasPath,
	QUEUE_PATH,
	queueConfirmPath,
	queueRejectPath,
	queueVariantPath,
} from "../shared/queue.ts";
import type {
	CorpusExclusionDocument,
	CorpusExclusionListDocument,
	CorpusExclusionUpsertRequest,
	ManualVariantCreateRequest,
	ManualVariantDocument,
	ManualVariantPatchRequest,
} from "../shared/manual.ts";
import {
	CORPUS_EXCLUSIONS_PATH,
	corpusExclusionPath,
	MANUAL_VARIANTS_PATH,
	manualVariantPath,
} from "../shared/manual.ts";

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(path, {
		headers: { accept: "application/json" },
		...(signal ? { signal } : {}),
	});
	if (response.status === 401 && typeof window !== "undefined") {
		window.location.assign(UNLOCK_PATH);
	}
	if (!response.ok) {
		throw new ApiError(response.status, `GET ${path} responded ${response.status}`);
	}
	return (await response.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthDocument> {
	return getJson<HealthDocument>(HEALTH_PATH, signal);
}

/**
 * The whole binder, in one request.
 *
 * No parameters, ever — not a page, not a filter. The service worker caches whatever comes back
 * from this URL, and a URL that varies would leave it holding one arbitrary slice of the
 * masterset instead of the masterset. Filtering happens over the document once it is here.
 */
export function fetchBinder(signal?: AbortSignal): Promise<BinderDocument> {
	return getJson<BinderDocument>(BINDER_PATH, signal);
}

export function fetchCorpusStatus(signal?: AbortSignal): Promise<CorpusStatusDocument> {
	return getJson<CorpusStatusDocument>(CORPUS_STATUS_PATH, signal);
}

export function fetchCorpusSyncJob(
	jobId: string,
	signal?: AbortSignal,
): Promise<CorpusSyncJobDocument> {
	return getJson<CorpusSyncJobDocument>(corpusSyncJobPath(jobId), signal);
}

/**
 * Start a sync and return as soon as the job exists.
 *
 * The response arrives long before the work finishes — that is the point. A `409` means one is
 * already running and comes back carrying that job, so the caller watches it rather than
 * reporting an error the owner can do nothing about.
 */
export async function startCorpusSync(): Promise<CorpusSyncJobDocument> {
	const response = await fetch(CORPUS_SYNC_PATH, {
		method: "POST",
		headers: { accept: "application/json" },
	});
	if (response.status === 202 || response.status === 409) {
		const body = (await response.json()) as { job: CorpusSyncJobDocument | null };
		if (body.job !== null) return body.job;
	}
	throw new ApiError(response.status, `POST ${CORPUS_SYNC_PATH} responded ${response.status}`);
}

/* -------------------------------------------------------------------------- */
/* The collection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Send a body and read one back.
 *
 * The server answers a rejected write with `{ error }` and a sentence written for the owner —
 * *a grade needs a grader*, not `SQLITE_CONSTRAINT`. Surfacing that sentence rather than the
 * status code is the difference between a form the owner can correct and one they can only retry.
 */
async function sendJson<T>(path: string, method: string, body: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
	});
	const payload: unknown = await response.json().catch(() => null);
	if (response.status === 401 && typeof window !== "undefined") {
		window.location.assign(UNLOCK_PATH);
	}
	if (!response.ok) {
		const message =
			typeof payload === "object" && payload !== null && "error" in payload
				? String((payload as { error: unknown }).error)
				: `${method} ${path} responded ${response.status}`;
		throw new ApiError(response.status, message);
	}
	return payload as T;
}

/**
 * One variant's copies, disposed ones included.
 *
 * A request of its own rather than a slice of the binder document: the trail carries prices,
 * notes and disposal dates for every card ever held, which does not belong in a 290 KB document
 * the phone re-downloads whenever the masterset changes. The consequence, stated rather than
 * hidden: **the sheet's copy list needs the tailnet.** Ownership itself does not — that rides on
 * the cached binder — so the grid still reads correctly offline.
 */
export async function fetchVariantCopies(
	cardKey: string,
	variantId: string,
	signal?: AbortSignal,
): Promise<readonly CopyDocument[]> {
	const body = await getJson<CopyListDocument>(variantCopiesPath(cardKey, variantId), signal);
	return body.copies;
}

/** Record a copy. The `id` is minted by the caller, so a replay lands in the same row. */
export function createCopy(request: CopyCreateRequest): Promise<CopyDocument> {
	return sendJson<CopyDocument>(COPIES_PATH, "POST", request);
}

export function updateCopy(id: string, patch: CopyPatchRequest): Promise<CopyDocument> {
	return sendJson<CopyDocument>(copyPath(id), "PATCH", patch);
}

/** Dispose of a copy. There is no delete: the row stays, marked, with its price and its note. */
export function disposeCopy(id: string, request: CopyDisposalRequest): Promise<CopyDocument> {
	return sendJson<CopyDocument>(copyDisposalPath(id), "POST", request);
}

export function fetchCompletion(signal?: AbortSignal): Promise<CompletionDocument> {
	return getJson<CompletionDocument>(COMPLETION_PATH, signal);
}

export function setVariantPriority(request: PriorityRequest): Promise<PriorityDocument> {
	return sendJson<PriorityDocument>(PRIORITIES_PATH, "PUT", request);
}

export function fetchListings(
	signal?: AbortSignal,
	options: { readonly locations?: readonly string[] } = {},
): Promise<ListingsDocument> {
	const params = new URLSearchParams();
	for (const location of options.locations ?? []) {
		params.append("location", location);
	}
	const query = params.toString();
	return getJson<ListingsDocument>(
		query === "" ? LISTINGS_PATH : `${LISTINGS_PATH}?${query}`,
		signal,
	);
}

export function fetchListing(itemId: string, signal?: AbortSignal): Promise<ListingDocument> {
	return getJson<ListingDocument>(listingPath(itemId), signal);
}

export function fetchQueue(signal?: AbortSignal): Promise<QueueDocument> {
	return getJson<QueueDocument>(QUEUE_PATH, signal);
}

export function confirmQueuedListing(
	itemId: string,
	request: QueueConfirmRequest & { readonly aliasId?: string },
): Promise<QueueResolutionDocument> {
	return sendJson<QueueResolutionDocument>(queueConfirmPath(itemId), "POST", request);
}

export function pickQueuedVariant(
	itemId: string,
	request: QueuePickVariantRequest & { readonly aliasId?: string },
): Promise<QueueResolutionDocument> {
	return sendJson<QueueResolutionDocument>(queueVariantPath(itemId), "POST", request);
}

export function rejectQueuedListing(itemId: string): Promise<QueueResolutionDocument> {
	return sendJson<QueueResolutionDocument>(queueRejectPath(itemId), "POST", {});
}

export function fetchAliases(signal?: AbortSignal): Promise<AliasListDocument> {
	return getJson<AliasListDocument>(ALIASES_PATH, signal);
}

export function createAlias(request: AliasCreateRequest): Promise<AliasDocument> {
	return sendJson<AliasDocument>(ALIASES_PATH, "POST", request);
}

export function updateAlias(id: string, patch: AliasPatchRequest): Promise<AliasDocument> {
	return sendJson<AliasDocument>(aliasPath(id), "PATCH", patch);
}

export async function deleteAlias(id: string): Promise<void> {
	const response = await fetch(aliasPath(id), {
		method: "DELETE",
		headers: { accept: "application/json" },
	});
	if (response.status === 401 && typeof window !== "undefined") {
		window.location.assign(UNLOCK_PATH);
	}
	if (!response.ok && response.status !== 204) {
		throw new ApiError(response.status, `DELETE ${aliasPath(id)} responded ${response.status}`);
	}
}

/* -------------------------------------------------------------------------- */
/* Hand-added variants and the exclusion list                                  */
/* -------------------------------------------------------------------------- */

export function createManualVariant(
	request: ManualVariantCreateRequest,
): Promise<ManualVariantDocument> {
	return sendJson<ManualVariantDocument>(MANUAL_VARIANTS_PATH, "POST", request);
}

export function updateManualVariant(
	cardKey: string,
	variantId: string,
	patch: ManualVariantPatchRequest,
): Promise<ManualVariantDocument> {
	return sendJson<ManualVariantDocument>(manualVariantPath(cardKey, variantId), "PATCH", patch);
}

export async function deleteManualVariant(cardKey: string, variantId: string): Promise<void> {
	const path = manualVariantPath(cardKey, variantId);
	const response = await fetch(path, { method: "DELETE", headers: { accept: "application/json" } });
	if (response.status === 401 && typeof window !== "undefined") {
		window.location.assign(UNLOCK_PATH);
	}
	if (response.status === 204) return;
	const payload: unknown = await response.json().catch(() => null);
	const message =
		typeof payload === "object" && payload !== null && "error" in payload
			? String((payload as { error: unknown }).error)
			: `DELETE ${path} responded ${response.status}`;
	throw new ApiError(response.status, message);
}

export async function fetchExclusions(
	signal?: AbortSignal,
): Promise<readonly CorpusExclusionDocument[]> {
	const body = await getJson<CorpusExclusionListDocument>(CORPUS_EXCLUSIONS_PATH, signal);
	return body.exclusions;
}

export function upsertExclusion(
	request: CorpusExclusionUpsertRequest,
): Promise<CorpusExclusionDocument> {
	return sendJson<CorpusExclusionDocument>(CORPUS_EXCLUSIONS_PATH, "PUT", request);
}

export async function deleteExclusion(cardKey: string): Promise<void> {
	const path = corpusExclusionPath(cardKey);
	const response = await fetch(path, { method: "DELETE", headers: { accept: "application/json" } });
	if (response.status === 401 && typeof window !== "undefined") {
		window.location.assign(UNLOCK_PATH);
	}
	if (response.status === 204) return;
	const payload: unknown = await response.json().catch(() => null);
	const message =
		typeof payload === "object" && payload !== null && "error" in payload
			? String((payload as { error: unknown }).error)
			: `DELETE ${path} responded ${response.status}`;
	throw new ApiError(response.status, message);
}
