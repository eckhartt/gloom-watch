/**
 * The binder document: every variant in the masterset, ordered, with its ownership state.
 *
 * One query over `corpus_variants` joined to `corpus_cards`, one over `corpus_sets`, one
 * ownership index, and a sort. At ~765 variants and ~137 sets that is a few milliseconds and a
 * couple of hundred kilobytes, which is why the spec can insist the whole thing is served in one
 * unpaginated request — the property that makes offline browsing and, later, client-side
 * filtering possible at all.
 *
 * The sets are joined **in TypeScript rather than in SQL**. A set's identity is
 * `{language}:{set_id}`, which the cards table does not hold as a column, so a SQL join would
 * mean concatenating two columns inside the ON clause. A 137-entry `Map` is clearer and, at this
 * size, faster than the query planner deciding what to do with an expression join.
 */

import { eq } from "drizzle-orm";
import type { BinderDocument, BinderEntry } from "../../shared/contract.ts";
import { binderEntryKey } from "../../shared/contract.ts";
import { readVariantPriorities } from "../copies/repository.ts";
import { readSets } from "../corpus/repository.ts";
import type { GloomDatabase } from "../db/client.ts";
import { corpusCards, corpusVariants } from "../db/schema.ts";
import { type OwnershipIndex, readOwnedCopyCounts } from "./ownership.ts";

export interface BinderDocumentDeps {
	readonly db: GloomDatabase;
	/** Injected so tests drive time without a global clock mock. */
	readonly now: () => number;
	/**
	 * Ownership, supplied rather than looked up, so a test can build the same document with an
	 * index it wrote by hand. Defaults to what the database actually holds.
	 */
	readonly ownership?: OwnershipIndex;
}

function parseStamps(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		// Stored by the ingest as JSON and never by hand, so this should not happen — but a single
		// malformed row must not take the whole binder down with it.
		return [];
	}
}

/** Digit runs and non-digit runs, so `44` and `SH3` can be compared a chunk at a time. */
const NUMBER_OR_TEXT_RUN = /\d+|\D+/g;

/**
 * Compare two card numbers the way a collector reads them.
 *
 * `local_id` is not a number. The corpus holds `44`, `002`, `SH3`, `XY99`, `H31` and `TG05`, so a
 * numeric cast puts `SH3` at zero and a plain string sort puts `10` before `2`. This walks both
 * strings in runs of digits and non-digits, comparing digit runs numerically and everything else
 * by code unit.
 *
 * **Deterministic on purpose, and hand-rolled for the same reason.** `Intl.Collator` with
 * `numeric: true` would do most of this, but its answer depends on the ICU version the runtime
 * was built against, and the binder's order must not shift under the owner because Bun updated.
 */
export function compareCardNumbers(a: string, b: string): number {
	const left = a.match(NUMBER_OR_TEXT_RUN) ?? [];
	const right = b.match(NUMBER_OR_TEXT_RUN) ?? [];

	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const l = left[i];
		const r = right[i];
		if (l === undefined) return -1;
		if (r === undefined) return 1;

		const lNumeric = l.charCodeAt(0) >= 48 && l.charCodeAt(0) <= 57;
		const rNumeric = r.charCodeAt(0) >= 48 && r.charCodeAt(0) <= 57;

		if (lNumeric !== rNumeric) {
			// A number sorts before a letter, so 1..102 precede SH1 and TG05 in a set that has both.
			return lNumeric ? -1 : 1;
		}
		if (lNumeric) {
			const difference = Number(l) - Number(r);
			if (difference !== 0) return difference;
			// `002` and `2` are numerically equal. Fall through to the literal so the order is total
			// rather than dependent on which row the database happened to return first.
		}
		if (l !== r) return l < r ? -1 : 1;
	}
	return 0;
}

/**
 * The binder's default order: **set release date descending, then card number.**
 *
 * Undated sets sort **last**, always, never first and never at random. Upstream carries a date
 * for every set this corpus references today — promos included, `miscp` is `1996-01-01` — but a
 * set added tomorrow may not, and a missing date must not silently become "released in year
 * zero" and float the newest-looking part of the binder to the bottom.
 *
 * Below the date the order is the builder's to choose, and it is chosen to be **total**: two
 * requests a millisecond apart return the same sequence, which is what makes the document
 * cacheable and its ETag meaningful.
 *
 * 1. release date, descending — ISO `YYYY-MM-DD` sorts lexically, so no parsing
 * 2. set key, ascending — keeps one set together when two were released the same day
 * 3. card number, ascending — the collector's reading order within a set
 * 4. variant id, ascending — the several variants of one card, in a fixed order
 */
function compareEntries(a: BinderEntry, b: BinderEntry): number {
	if (a.setReleaseDate !== b.setReleaseDate) {
		if (a.setReleaseDate === null) return 1;
		if (b.setReleaseDate === null) return -1;
		return a.setReleaseDate < b.setReleaseDate ? 1 : -1;
	}
	const aSetKey = `${a.language}:${a.setId}`;
	const bSetKey = `${b.language}:${b.setId}`;
	if (aSetKey !== bSetKey) return aSetKey < bSetKey ? -1 : 1;

	const byNumber = compareCardNumbers(a.localId, b.localId);
	if (byNumber !== 0) return byNumber;

	if (a.variantId === b.variantId) return 0;
	return a.variantId < b.variantId ? -1 : 1;
}

export function buildBinderDocument(deps: BinderDocumentDeps): BinderDocument {
	const { db } = deps;
	const ownership = deps.ownership ?? readOwnedCopyCounts(db);

	const setsByKey = new Map(readSets(db).map((set) => [set.setKey, set]));
	// Joined in TypeScript for the same reason the sets are: a `Map` keyed on the composed
	// identity is clearer than a SQL join on two columns, and there are only ever as many rows
	// here as variants the owner has bothered to rank.
	const priorityByKey = new Map(
		readVariantPriorities(db).map((row) => [
			binderEntryKey(row.cardKey, row.variantId),
			row.priority,
		]),
	);

	const rows = db
		.select({
			cardKey: corpusVariants.cardKey,
			variantId: corpusVariants.variantId,
			finish: corpusVariants.finish,
			subtype: corpusVariants.subtype,
			stamps: corpusVariants.stamps,
			foil: corpusVariants.foil,
			size: corpusVariants.size,
			variantMissing: corpusVariants.missingUpstream,
			language: corpusCards.language,
			setId: corpusCards.setId,
			setName: corpusCards.setName,
			localId: corpusCards.localId,
			name: corpusCards.name,
			rarity: corpusCards.rarity,
			imageByteSize: corpusCards.imageByteSize,
			cardMissing: corpusCards.missingUpstream,
			provenance: corpusCards.provenance,
		})
		.from(corpusVariants)
		.innerJoin(corpusCards, eq(corpusCards.cardKey, corpusVariants.cardKey))
		.all();

	const entries = rows.map((row): BinderEntry => {
		const key = binderEntryKey(row.cardKey, row.variantId);
		const set = setsByKey.get(`${row.language}:${row.setId}`);
		return {
			key,
			cardKey: row.cardKey,
			variantId: row.variantId,
			language: row.language,
			setId: row.setId,
			// The set row's name is the authoritative one — it came from the set endpoint in the
			// set's own language. The card's copy is the fallback for a set that has no row yet.
			setName: set?.name ?? row.setName,
			setReleaseDate: set?.releaseDate ?? null,
			localId: row.localId,
			name: row.name,
			rarity: row.rarity,
			finish: row.finish,
			subtype: row.subtype,
			stamps: parseStamps(row.stamps),
			foil: row.foil,
			size: row.size,
			hasImage: (row.imageByteSize ?? 0) > 0,
			// A variant whose *card* vanished upstream is missing too, whatever its own flag says.
			missingUpstream: row.variantMissing === 1 || row.cardMissing === 1,
			provenance: row.provenance === "manual" ? "manual" : "tcgdex",
			ownedCopies: ownership.get(key) ?? 0,
			priority: priorityByKey.get(key) ?? null,
		};
	});

	entries.sort(compareEntries);

	return { generatedAt: deps.now(), entries };
}
