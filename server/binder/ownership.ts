/**
 * How many copies the owner currently holds of each variant.
 *
 * **There is no copies table yet.** One row per physical card — with its condition or grade, its
 * cert number, what was paid and where it came from — is the next ticket (`01m04pm9t9`), which
 * this one blocks. So this reads a source that exists and yields nothing, and every entry in the
 * binder honestly reports zero copies today.
 *
 * It is a function over the database rather than a `false` written into the document builder,
 * and that distinction is the point. Ownership already travels the whole way — through the
 * repository, the binder document, the wire contract, the cell's visual treatment and the sheet
 * — so the copies ticket fills this one function in and nothing else moves. A hardcoded `false`
 * sprinkled through the client would instead have to be found and unpicked in five places, and
 * the "owned and needed are distinguishable at a glance" criterion could not be proved until
 * copies existed.
 *
 * Keyed by `binderEntryKey(cardKey, variantId)` — never by `variantId`, which 264 different
 * cards share in the live corpus.
 *
 * **Every ownership query filters `status = 'owned'`.** The spec keeps disposed copies as rows
 * so the purchase history and upgrade trail survive, and counting them would inflate completion.
 * That filter belongs in this function when it grows a query, and it is easy to forget once.
 */

import type { GloomDatabase } from "../db/client.ts";

/** `binderEntryKey` → number of copies held at `status = 'owned'`. Absent means none. */
export type OwnershipIndex = ReadonlyMap<string, number>;

export function readOwnedCopyCounts(_db: GloomDatabase): OwnershipIndex {
	return new Map();
}
