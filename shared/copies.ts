/**
 * Copies — the physical cards the owner actually holds — and the completion figure that follows
 * from them. The wire vocabulary, shared by both sides so the server's validation and the sheet's
 * form cannot drift apart.
 *
 * **A copy is one physical card, never a quantity.** A PSA 9 and a raw copy of the same variant
 * are two rows, not a count of two, because everything worth recording about a card — its
 * condition, its cert number, what it cost, where it came from — belongs to that one object.
 *
 * It points at exactly one variant by the composite identity `(card_key, variant_id)`. Never
 * `variant_id` alone: 817 variants in the live corpus carry 21 distinct `variant_id`s, the worst
 * shared by 264 different cards.
 */

/**
 * The hobby's condition ladder — TCGplayer's and Cardmarket's, which is what a trade conversation
 * and every price guide uses.
 *
 * **This is not eBay's vocabulary and nothing here claims it is.** Decision `01m04k28t8` withdrew
 * that claim: eBay's Card Condition has four values (Near mint or better / Excellent / Very good
 * / Poor) and **no rung for a damaged card**, so `DMG` has nowhere to go and any mapping would
 * have to invent a destination for it. There is deliberately no translation table in this
 * repository, and a listing's `conditionId` means graded-or-ungraded, never a condition.
 *
 * Omitted for a graded slab: the number on the label is the condition, and a second opinion
 * recorded beside it would be the owner's guess competing with the grader's.
 */
export const COPY_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CopyCondition = (typeof COPY_CONDITIONS)[number];

export const COPY_GRADERS = ["PSA", "BGS", "CGC", "SGC", "ACE"] as const;
export type CopyGrader = (typeof COPY_GRADERS)[number];

/**
 * Where a copy came from, as a coarse category. **Distinct from a variant's `provenance`**, which
 * says whether the *row* came from TCGdex or was typed by hand; the two were briefly both called
 * "source" and one word covering both would have become two implementations.
 *
 * Coarse plus a free-text note, so provenance is captured without the app storing eBay user data.
 */
export const COPY_SOURCE_TYPES = ["ebay", "shop", "trade", "gift", "auction", "other"] as const;
export type CopySourceType = (typeof COPY_SOURCE_TYPES)[number];

/**
 * **Disposal retains the row.** A sold or traded card keeps its record, marked `disposed`, so the
 * purchase history and the upgrade trail survive. It is a state change and never a delete — there
 * is no route in this application that deletes a copy.
 */
export const COPY_STATUSES = ["owned", "disposed"] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

/** The status every ownership query filters on. Named so no query has to spell it. */
export const OWNED: CopyStatus = "owned";

export const COPY_DISPOSAL_KINDS = ["sold", "traded", "lost"] as const;
export type CopyDisposalKind = (typeof COPY_DISPOSAL_KINDS)[number];

/**
 * Cert numbers are ≤30 characters — eBay's own bound on the certification-number descriptor, and
 * roughly twice the length of any real one. It identifies one physical slab, which is what makes
 * it worth storing: the owner can recognise their own card if it resurfaces on the market.
 */
export const CERT_NO_MAX_LENGTH = 30;

/**
 * Priority is **0–3, on the variant**, and `priority_instant_level`
 * (`DEFAULT_PRIORITY_INSTANT_LEVEL`, 3) is the rung that earns an instant push rather than a
 * place in the next digest.
 *
 * It belongs to the variant rather than to a copy because by definition there is no copy — it is
 * the dial for a card the owner does *not* hold. There is no want-list: anything unowned is
 * implicitly wanted, and this only ranks it.
 */
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 3;
/** Every rung, lowest first — what a control offers, so nobody re-derives the range by arithmetic. */
export const PRIORITY_LEVELS = [0, 1, 2, 3] as const;
/** Starting value of `priority_instant_level`. Instant push, not digest, at or above this rung. */
export const DEFAULT_PRIORITY_INSTANT_LEVEL = 3;

/**
 * Grade is an **integer in tenths**, so `PSA 8.5` is `85` and compares exactly against a grade
 * parsed off a listing title. A float would make `8.5 === 8.5` a question about binary
 * representation.
 *
 * **`grade` requires `grader`.** A bare `9` is not a fact about a card; PSA 9 and BGS 9 are
 * different claims made by different companies.
 */
export const MIN_GRADE_TENTHS = 10;
export const MAX_GRADE_TENTHS = 100;

/**
 * `8.5` → `85`, and `null` for anything that is not a grade.
 *
 * **Rejects anything below 1.0**, which is not a limitation but the point: no grader on the list
 * issues a grade under 1, so a bare `9` typed into a field asking for tenths would be 0.9 — a
 * plausible number, silently a hundredth of what was meant. Rejecting it turns that into a
 * message instead of a wrong slab.
 */
export function parseGradeTenths(value: string): number | null {
	const match = /^(\d{1,2})(?:\.(\d))?$/.exec(value.trim());
	if (match === null) return null;
	const tenths = Number(match[1]) * 10 + Number(match[2] ?? 0);
	if (tenths < MIN_GRADE_TENTHS || tenths > MAX_GRADE_TENTHS) return null;
	return tenths;
}

/** `85` → `8.5`, `100` → `10`. The label as the grader prints it. */
export function formatGradeTenths(tenths: number): string {
	const whole = Math.floor(tenths / 10);
	const remainder = tenths % 10;
	return remainder === 0 ? String(whole) : `${whole}.${remainder}`;
}

/**
 * One physical card, as it travels the wire.
 *
 * Calendar dates — `acquiredAt`, `rateDate`, `disposedAt` — are **ISO `YYYY-MM-DD` strings and
 * are never converted to instants**. A card acquired "on 3 March" was not acquired at a moment in
 * UTC, and `new Date("2024-03-03")` is midnight UTC, which read in Brisbane is the 3rd and read in
 * Los Angeles is the 2nd. `createdAt` and `updatedAt` *are* instants and are epoch milliseconds.
 *
 * There is **no defect field**, and there is not going to be one. A miscut, an ink error, a
 * colour shift or an off-centre cut happened to this one object rather than to a print run, and
 * the spec models it nowhere: no enum, no boolean, no sortable column. It may be prose in `note`.
 */
export interface CopyDocument {
	/** A UUID minted by the client. See `CopyCreateRequest`. */
	readonly id: string;
	readonly cardKey: string;
	readonly variantId: string;
	readonly condition: CopyCondition | null;
	readonly grader: CopyGrader | null;
	/** Integer tenths. `null` unless `grader` is set. */
	readonly grade: number | null;
	readonly certNo: string | null;
	/** Integer minor units. Meaningless without `currency`, which is why they move together. */
	readonly priceMinor: number | null;
	readonly currency: string | null;
	/** What it was worth in the home currency, captured at purchase — the rate is not recoverable. */
	readonly priceHomeMinor: number | null;
	readonly homeCurrency: string | null;
	/** ISO `YYYY-MM-DD`. When the conversion above was taken, entered by hand. */
	readonly rateDate: string | null;
	readonly acquiredAt: string | null;
	readonly sourceType: CopySourceType | null;
	readonly sourceNote: string | null;
	readonly note: string | null;
	readonly status: CopyStatus;
	readonly disposedAt: string | null;
	readonly disposalKind: CopyDisposalKind | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

/** The fields a copy carries beyond its identity and its lifecycle. Shared by create and edit. */
export interface CopyFields {
	readonly condition?: CopyCondition | null;
	readonly grader?: CopyGrader | null;
	readonly grade?: number | null;
	readonly certNo?: string | null;
	readonly priceMinor?: number | null;
	readonly currency?: string | null;
	readonly priceHomeMinor?: number | null;
	readonly homeCurrency?: string | null;
	readonly rateDate?: string | null;
	readonly acquiredAt?: string | null;
	readonly sourceType?: CopySourceType | null;
	readonly sourceNote?: string | null;
	readonly note?: string | null;
}

/**
 * Recording a copy.
 *
 * **The client mints `id`, and it is the primary key.** That is what makes an outbox replay
 * idempotent: a create whose response was lost on a dropping tailnet replays into the same row
 * rather than into a second card the owner does not have. A server-generated identifier could
 * not do that, because the client would have nothing to replay *with*.
 */
export interface CopyCreateRequest extends CopyFields {
	readonly id: string;
	readonly cardKey: string;
	readonly variantId: string;
}

/**
 * Editing a copy.
 *
 * **An absent key leaves the field alone; an explicit `null` clears it.** JSON tells the two
 * apart and a patch that could not would make clearing a price impossible.
 *
 * `status` is deliberately not here. Disposal has its own route, so nothing that looks like an
 * ordinary edit can quietly take a card out of the collection.
 */
export type CopyPatchRequest = CopyFields;

/** Disposing of a copy. `disposedAt` is required — a disposal with no date is not a record. */
export interface CopyDisposalRequest {
	/** ISO `YYYY-MM-DD`. */
	readonly disposedAt: string;
	readonly disposalKind?: CopyDisposalKind | null;
	/** Appended to the copy's note if given, so why it went is kept with the card. */
	readonly note?: string | null;
}

export interface CopyListDocument {
	readonly copies: readonly CopyDocument[];
}

/**
 * Completion.
 *
 * **Numerator:** variants with at least one copy at `status = 'owned'`.
 *
 * **Denominator:** every variant *except* those flagged `missing_upstream` that the owner does not
 * own — per decision `01m04jea06`. An upstream deletion therefore cannot cap the figure below
 * 100%, while a card the owner physically holds never vanishes from the total.
 *
 * **How this is presented numerically is still open** and is not decided here or by whatever
 * renders it. The two numbers are what the spec defines; a percentage, a bar or a ratio is a
 * choice nobody has made yet.
 *
 * Expect it to **go down after a corpus sync** when upstream adds a language or a variant. That is
 * correct for a masterset and is why the denominator is not a constant.
 */
export interface CompletionDocument {
	/** Variants with at least one owned copy. */
	readonly owned: number;
	/** The denominator, after the `missing_upstream` rule. */
	readonly total: number;
	/** Variants left out: flagged missing upstream and not owned. Reported so the rule is visible. */
	readonly missingUpstreamExcluded: number;
}

/** Setting the dial on a variant. `null` clears it. */
export interface PriorityRequest {
	readonly cardKey: string;
	readonly variantId: string;
	readonly priority: number | null;
}

export interface PriorityDocument {
	readonly cardKey: string;
	readonly variantId: string;
	readonly priority: number | null;
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/copies?cardKey=&variantId=` lists one variant's copies, disposed ones included;
 * `POST /api/copies` records one.
 */
export const COPIES_PATH = "/api/copies";

export function variantCopiesPath(cardKey: string, variantId: string): string {
	const query = new URLSearchParams({ cardKey, variantId });
	return `${COPIES_PATH}?${query.toString()}`;
}

/** `PATCH /api/copies/{id}` edits. There is no `DELETE`, by design. */
export function copyPath(id: string): string {
	return `${COPIES_PATH}/${encodeURIComponent(id)}`;
}

/**
 * `POST /api/copies/{id}/disposal`.
 *
 * A route of its own rather than a status field on the edit route, so that disposing of a card is
 * something the owner did on purpose and never a side effect of correcting a typo.
 */
export function copyDisposalPath(id: string): string {
	return `${copyPath(id)}/disposal`;
}

/** `GET /api/completion`. */
export const COMPLETION_PATH = "/api/completion";

/** `PUT /api/priorities` — idempotent by nature, so replaying one is harmless. */
export const PRIORITIES_PATH = "/api/priorities";
