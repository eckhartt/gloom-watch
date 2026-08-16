/**
 * What the server will accept as a copy, and what it refuses.
 *
 * Two rules here are acceptance criteria of the ticket rather than tidiness:
 *
 * - **`grade` requires `grader`.** A bare `9` is not a fact about a card. PSA 9 and BGS 9 are
 *   different claims made by different companies against different rubrics, and a number with no
 *   author cannot be compared with the grade parsed off a listing title later.
 * - **A home-currency amount requires its currency and its rate date.** The rate is entered by
 *   hand and there is no FX API to recover it from, so an amount stored without the date it was
 *   taken is a number nobody can ever interpret again.
 *
 * The same rules are `CHECK` constraints on the table. This layer exists so the owner gets a
 * sentence instead of `SQLITE_CONSTRAINT`; the table's copy exists because an import route and an
 * outbox replay are both coming, and a rule enforced only in a request handler is a rule that
 * holds only for requests.
 */

import type {
	CopyCondition,
	CopyCreateRequest,
	CopyDisposalKind,
	CopyDisposalRequest,
	CopyFields,
	CopyGrader,
	CopyPatchRequest,
	CopySourceType,
	PriorityRequest,
} from "../../shared/copies.ts";
import {
	CERT_NO_MAX_LENGTH,
	COPY_CONDITIONS,
	COPY_DISPOSAL_KINDS,
	COPY_GRADERS,
	COPY_SOURCE_TYPES,
	MAX_GRADE_TENTHS,
	MAX_PRIORITY,
	MIN_GRADE_TENTHS,
	MIN_PRIORITY,
} from "../../shared/copies.ts";
import { isCurrencyCode } from "../../shared/money.ts";

export class InvalidCopyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidCopyError";
	}
}

function asRecord(body: unknown, what: string): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidCopyError(`${what} must be a JSON object`);
	}
	return body as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidCopyError(`${field} is required and must be a non-empty string`);
	}
	return value;
}

/**
 * A UUID, in the shape a browser's `crypto.randomUUID()` produces.
 *
 * Checked rather than merely accepted as an opaque string, because the identifier being *the
 * client's* is what makes the outbox's replay idempotent. A server that quietly accepted `1` would
 * be accepting an identifier the client cannot regenerate after a reload, and the defect would
 * surface a ticket later as duplicated cards.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ISO `YYYY-MM-DD`, checked against the calendar and not only against the shape — `2025-02-30`
 * matches any regex worth writing. Round-tripped through UTC deliberately: this validates a
 * calendar date and never converts one, since the string is what gets stored.
 */
function isIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (match === null) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function optionalDate(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || !isIsoDate(value)) {
		throw new InvalidCopyError(`${field} must be an ISO calendar date, YYYY-MM-DD`);
	}
	return value;
}

function optionalMember<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
): T | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new InvalidCopyError(`${field} must be one of ${allowed.join(", ")}`);
	}
	return value as T;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw new InvalidCopyError(`${field} must be a string`);
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (trimmed.length > maxLength) {
		throw new InvalidCopyError(`${field} must be at most ${maxLength} characters`);
	}
	return trimmed;
}

/** Minor units. **An integer, always** — a fractional minor unit is the float this design forbids. */
function optionalMinor(value: unknown, field: string): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new InvalidCopyError(`${field} must be a whole number of minor units, never a decimal`);
	}
	if (value < 0) throw new InvalidCopyError(`${field} must not be negative`);
	return value;
}

function optionalCurrency(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	if (!isCurrencyCode(value)) {
		throw new InvalidCopyError(`${field} must be a three-letter ISO 4217 code, upper case`);
	}
	return value;
}

function optionalGrade(value: unknown): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new InvalidCopyError("grade must be an integer number of tenths — PSA 8.5 is 85");
	}
	if (value < MIN_GRADE_TENTHS || value > MAX_GRADE_TENTHS) {
		// A `9` meaning PSA 9 would otherwise be stored as 0.9: plausible, silent and wrong by a
		// factor of ten. No grader on the list issues anything below 1.0, so the range catches it.
		throw new InvalidCopyError(
			`grade is in tenths and must be between ${MIN_GRADE_TENTHS} and ${MAX_GRADE_TENTHS} — PSA 8.5 is 85, not 8.5`,
		);
	}
	return value;
}

/** Parse whichever of the copy's own fields are present, without deciding what absence means. */
function parseFields(raw: Record<string, unknown>): Record<string, unknown> {
	const parsed: Record<string, unknown> = {};
	const carry = (key: string, value: unknown) => {
		if (key in raw) parsed[key] = value;
	};

	carry("condition", optionalMember<CopyCondition>(raw.condition, COPY_CONDITIONS, "condition"));
	carry("grader", optionalMember<CopyGrader>(raw.grader, COPY_GRADERS, "grader"));
	carry("grade", optionalGrade(raw.grade));
	carry("certNo", optionalText(raw.certNo, "certNo", CERT_NO_MAX_LENGTH));
	carry("priceMinor", optionalMinor(raw.priceMinor, "priceMinor"));
	carry("currency", optionalCurrency(raw.currency, "currency"));
	carry("priceHomeMinor", optionalMinor(raw.priceHomeMinor, "priceHomeMinor"));
	carry("homeCurrency", optionalCurrency(raw.homeCurrency, "homeCurrency"));
	carry("rateDate", optionalDate(raw.rateDate, "rateDate"));
	carry("acquiredAt", optionalDate(raw.acquiredAt, "acquiredAt"));
	carry(
		"sourceType",
		optionalMember<CopySourceType>(raw.sourceType, COPY_SOURCE_TYPES, "sourceType"),
	);
	carry("sourceNote", optionalText(raw.sourceNote, "sourceNote", 500));
	carry("note", optionalText(raw.note, "note", 4000));

	return parsed;
}

/**
 * The cross-field rules, checked against the **whole** copy rather than against the request.
 *
 * That distinction is the reason this is a separate function: patching `grade` onto a copy that
 * has no grader is exactly as wrong as creating one that way, and a validator that only looked at
 * what arrived would let the second through.
 */
export function assertCopyInvariants(copy: CopyFields): void {
	if (copy.grade !== undefined && copy.grade !== null && (copy.grader ?? null) === null) {
		throw new InvalidCopyError("a grade needs a grader — PSA 9 and BGS 9 are different claims");
	}
	if (
		copy.priceMinor !== undefined &&
		copy.priceMinor !== null &&
		(copy.currency ?? null) === null
	) {
		throw new InvalidCopyError("a price needs its currency; a bare number is not an amount");
	}
	if (copy.priceHomeMinor !== undefined && copy.priceHomeMinor !== null) {
		if ((copy.homeCurrency ?? null) === null) {
			throw new InvalidCopyError("a home-currency amount needs its currency");
		}
		if ((copy.rateDate ?? null) === null) {
			// There is no FX API to recover the rate from, so an amount with no date is unreadable.
			throw new InvalidCopyError("a home-currency amount needs the date its rate was taken");
		}
	}
}

export function parseCopyCreateRequest(body: unknown): CopyCreateRequest {
	const raw = asRecord(body, "a copy");
	const id = requiredString(raw.id, "id");
	if (!UUID.test(id)) {
		throw new InvalidCopyError("id must be a UUID minted by the client");
	}

	const request = {
		id,
		cardKey: requiredString(raw.cardKey, "cardKey"),
		variantId: requiredString(raw.variantId, "variantId"),
		...parseFields(raw),
	} as CopyCreateRequest;

	assertCopyInvariants(request);
	return request;
}

export function parseCopyPatchRequest(body: unknown): CopyPatchRequest {
	const raw = asRecord(body, "a copy edit");
	if ("status" in raw || "disposedAt" in raw || "disposalKind" in raw) {
		// Not a silent ignore: an edit that thought it was disposing of a card and was quietly not
		// is worse than a refusal, and the disposal route is right there.
		throw new InvalidCopyError("disposal is its own route; an edit cannot change status");
	}
	return parseFields(raw) as CopyPatchRequest;
}

export function parseDisposalRequest(body: unknown): CopyDisposalRequest {
	const raw = asRecord(body, "a disposal");
	const disposedAt = optionalDate(raw.disposedAt, "disposedAt");
	if (disposedAt === null) {
		throw new InvalidCopyError("disposedAt is required — a disposal with no date is not a record");
	}
	const kind = optionalMember<CopyDisposalKind>(
		raw.disposalKind,
		COPY_DISPOSAL_KINDS,
		"disposalKind",
	);
	return {
		disposedAt,
		disposalKind: kind,
		note: optionalText(raw.note, "note", 500),
	};
}

export function parsePriorityRequest(body: unknown): PriorityRequest {
	const raw = asRecord(body, "a priority");
	const priority = raw.priority;
	if (priority !== null && priority !== undefined) {
		if (
			typeof priority !== "number" ||
			!Number.isInteger(priority) ||
			priority < MIN_PRIORITY ||
			priority > MAX_PRIORITY
		) {
			throw new InvalidCopyError(
				`priority must be an integer from ${MIN_PRIORITY} to ${MAX_PRIORITY}, or null to clear it`,
			);
		}
	}
	return {
		cardKey: requiredString(raw.cardKey, "cardKey"),
		variantId: requiredString(raw.variantId, "variantId"),
		priority: typeof priority === "number" ? priority : null,
	};
}
