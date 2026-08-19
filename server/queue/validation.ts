import type { CopyCreateRequest } from "../../shared/copies.ts";
import type {
	AliasCreateRequest,
	AliasPatchRequest,
	QueueConfirmRequest,
	QueueCopyWrite,
	QueuePickVariantRequest,
} from "../../shared/queue.ts";
import { InvalidCopyError, parseCopyCreateRequest } from "../copies/validation.ts";

export class InvalidQueueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidQueueError";
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHRASE_MAX = 200;

function asRecord(body: unknown, what: string): Record<string, unknown> {
	if (typeof body === "undefined" || body === null) return {};
	if (typeof body !== "object" || Array.isArray(body)) {
		throw new InvalidQueueError(`${what} must be a JSON object`);
	}
	return body as Record<string, unknown>;
}

function optionalString(value: unknown, field: string, max = PHRASE_MAX): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidQueueError(`${field} must be a non-empty string`);
	}
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw new InvalidQueueError(`${field} must be at most ${max} characters`);
	}
	return trimmed;
}

function optionalUuid(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !UUID.test(value)) {
		throw new InvalidQueueError(`${field} must be a UUID minted by the client`);
	}
	return value;
}

function requiredString(value: unknown, field: string): string {
	const parsed = optionalString(value, field);
	if (parsed === undefined) throw new InvalidQueueError(`${field} is required`);
	return parsed;
}

function requiredUuid(value: unknown, field: string): string {
	const parsed = optionalUuid(value, field);
	if (parsed === undefined)
		throw new InvalidQueueError(`${field} must be a UUID minted by the client`);
	return parsed;
}

function parseCopyWrite(
	value: unknown,
	cardKey: string,
	variantId: string,
): CopyCreateRequest | undefined {
	if (value === undefined || value === null) return undefined;
	try {
		return parseCopyCreateRequest({
			...(value as object),
			cardKey,
			variantId,
		});
	} catch (cause) {
		if (cause instanceof InvalidCopyError) throw new InvalidQueueError(cause.message);
		throw cause;
	}
}

export function parseConfirmRequest(body: unknown): QueueConfirmRequest & {
	readonly aliasId?: string;
} {
	const raw = asRecord(body, "a confirmation");
	return {
		phrase: optionalString(raw.phrase, "phrase"),
		cardKey: optionalString(raw.cardKey, "cardKey", 200),
		variantId: raw.variantId === null ? null : optionalString(raw.variantId, "variantId", 200),
		recordCopy: raw.recordCopy as QueueCopyWrite | undefined,
		aliasId: optionalUuid(raw.aliasId, "aliasId"),
	};
}

export function parsePickVariantRequest(body: unknown): QueuePickVariantRequest & {
	readonly aliasId?: string;
} {
	const raw = asRecord(body, "a variant pick");
	return {
		variantId: requiredString(raw.variantId, "variantId"),
		phrase: optionalString(raw.phrase, "phrase"),
		recordCopy: raw.recordCopy as QueueCopyWrite | undefined,
		aliasId: optionalUuid(raw.aliasId, "aliasId"),
	};
}

export function copyFromRuling(
	recordCopy: QueueCopyWrite | undefined,
	cardKey: string,
	variantId: string,
): CopyCreateRequest | undefined {
	return parseCopyWrite(recordCopy, cardKey, variantId);
}

export function parseAliasCreateRequest(body: unknown): AliasCreateRequest {
	const raw = asRecord(body, "an alias");
	const variantId =
		raw.variantId === undefined || raw.variantId === null
			? null
			: requiredString(raw.variantId, "variantId");
	return {
		id: requiredUuid(raw.id, "id"),
		phrase: requiredString(raw.phrase, "phrase"),
		cardKey: requiredString(raw.cardKey, "cardKey"),
		variantId,
	};
}

export function parseAliasPatchRequest(body: unknown): AliasPatchRequest {
	const raw = asRecord(body, "an alias edit");
	const phrase = "phrase" in raw ? requiredString(raw.phrase, "phrase") : undefined;
	const cardKey = "cardKey" in raw ? requiredString(raw.cardKey, "cardKey") : undefined;
	const hasVariant = "variantId" in raw;
	const variantId = hasVariant
		? raw.variantId === null
			? null
			: requiredString(raw.variantId, "variantId")
		: undefined;
	if (phrase === undefined && cardKey === undefined && !hasVariant) {
		throw new InvalidQueueError("an alias edit must change phrase, cardKey or variantId");
	}
	return {
		...(phrase === undefined ? {} : { phrase }),
		...(cardKey === undefined ? {} : { cardKey }),
		...(hasVariant ? { variantId } : {}),
	};
}

export function mintAliasId(requested: string | undefined): string {
	return requested ?? crypto.randomUUID();
}
