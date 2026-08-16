import { HEALTH_PATH, type HealthDocument } from "../shared/contract.ts";

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthDocument> {
	const response = await fetch(HEALTH_PATH, {
		headers: { accept: "application/json" },
		...(signal ? { signal } : {}),
	});
	if (!response.ok) {
		throw new ApiError(response.status, `GET ${HEALTH_PATH} responded ${response.status}`);
	}
	return (await response.json()) as HealthDocument;
}
