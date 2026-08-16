import type {
	CorpusStatusDocument,
	CorpusSyncJobDocument,
	HealthDocument,
} from "../shared/contract.ts";
import {
	CORPUS_STATUS_PATH,
	CORPUS_SYNC_PATH,
	corpusSyncJobPath,
	HEALTH_PATH,
} from "../shared/contract.ts";

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
	if (!response.ok) {
		throw new ApiError(response.status, `GET ${path} responded ${response.status}`);
	}
	return (await response.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthDocument> {
	return getJson<HealthDocument>(HEALTH_PATH, signal);
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
