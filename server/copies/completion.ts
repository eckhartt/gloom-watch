/**
 * Completion — how much of the masterset the owner actually holds.
 *
 * **Numerator:** variants with at least one copy at `status = 'owned'`.
 *
 * **Denominator:** every variant *except* those flagged `missing_upstream` that the owner does
 * **not** own — decision `01m04jea06`. Both halves of that rule matter and they pull in opposite
 * directions: an upstream data correction cannot cap the figure below 100% by leaving a phantom
 * row in the target, and a card the owner physically holds never vanishes from the total because
 * somebody else deleted a record.
 *
 * **Computed from the ownership index rather than from a query of its own.** That is the whole of
 * how "every ownership query filters on owned status" is enforced here: there is one ownership
 * query in the application, `readOwnedCopyCounts`, and completion reads its result. A second
 * query would be a second chance to forget the filter, and it would buy nothing — the index is
 * already in memory whenever the binder is built.
 *
 * **Nothing is cached.** The denominator moves on a corpus sync and the numerator on every copy
 * recorded or disposed of, and the sync can run in a *different OS process* (`bun run
 * corpus:sync` is a `Bun.cron` entry, not a request), which cannot reach this process's memory.
 * A memo here would therefore be exactly the thing that made the figure wrong after the event the
 * spec names first. It is a scan of ~800 rows against an index; the honest answer is cheaper than
 * the machinery to avoid it. The caches that do exist — the client's query cache and the binder's
 * ETag — are invalidated by the write, which is where invalidation can actually be correct.
 */

import { eq } from "drizzle-orm";
import { binderEntryKey } from "../../shared/contract.ts";
import type { CompletionDocument } from "../../shared/copies.ts";
import { readOwnedCopyCounts } from "../binder/ownership.ts";
import type { GloomDatabase } from "../db/client.ts";
import { corpusCards, corpusVariants } from "../db/schema.ts";

export function readCompletion(db: GloomDatabase): CompletionDocument {
	const ownership = readOwnedCopyCounts(db);

	const rows = db
		.select({
			cardKey: corpusVariants.cardKey,
			variantId: corpusVariants.variantId,
			variantMissing: corpusVariants.missingUpstream,
			cardMissing: corpusCards.missingUpstream,
		})
		.from(corpusVariants)
		.innerJoin(corpusCards, eq(corpusCards.cardKey, corpusVariants.cardKey))
		.all();

	let owned = 0;
	let total = 0;

	for (const row of rows) {
		const held = (ownership.get(binderEntryKey(row.cardKey, row.variantId)) ?? 0) > 0;
		// A variant whose *card* vanished upstream is missing too, whatever its own flag says — the
		// same rule the binder document applies, so the grid and the figure cannot disagree.
		const missingUpstream = row.variantMissing === 1 || row.cardMissing === 1;

		if (held) owned++;
		if (!missingUpstream || held) total++;
	}

	return { owned, total, missingUpstreamExcluded: rows.length - total };
}
