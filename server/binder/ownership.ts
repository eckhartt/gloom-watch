/**
 * How many copies the owner currently holds of each variant.
 *
 * **This is the only place in the application that answers "what does the owner hold".** Not by
 * convention — by arithmetic: the binder document reads this index, and completion is computed
 * from the same index rather than from a second query of its own. One query means one place the
 * `status = 'owned'` filter can be forgotten, and `tests/ownership-filter.test.ts` fails if a
 * second one ever appears.
 *
 * The binder ticket left this function returning an empty map because there was no copies table.
 * Filling it in is the whole of the read path for this ticket: ownership already travelled
 * through the repository, the document, the wire contract, the cell's visual treatment and the
 * sheet, so nothing else on that path had to move.
 *
 * **Keyed by `binderEntryKey(cardKey, variantId)` — never by `variantId`.** In the live corpus 817
 * variants carry 21 distinct `variant_id`s, the most-shared held by 264 different cards and the
 * literal string `"generated"` by 106. Keyed on `variantId` this index would collapse to 21
 * entries and report hundreds of cards as owned because one of them is, with no error anywhere.
 *
 * **Every ownership query filters `status = 'owned'`.** Disposed copies keep their rows so the
 * purchase history and the upgrade trail survive; counting them would say the owner holds a card
 * they sold, and would inflate completion silently and plausibly.
 *
 * A **count**, not a boolean: a PSA 9 and a raw copy of one variant are two rows, and the sheet
 * shows the number.
 */

import { count, eq } from "drizzle-orm";
import { binderEntryKey } from "../../shared/contract.ts";
import { OWNED } from "../../shared/copies.ts";
import type { GloomDatabase } from "../db/client.ts";
import { copies } from "../db/schema.ts";

/** `binderEntryKey` → number of copies held at `status = 'owned'`. Absent means none. */
export type OwnershipIndex = ReadonlyMap<string, number>;

export function readOwnedCopyCounts(db: GloomDatabase): OwnershipIndex {
	const rows = db
		.select({
			cardKey: copies.cardKey,
			variantId: copies.variantId,
			held: count(),
		})
		.from(copies)
		.where(eq(copies.status, OWNED))
		.groupBy(copies.cardKey, copies.variantId)
		.all();

	return new Map(rows.map((row) => [binderEntryKey(row.cardKey, row.variantId), row.held]));
}
