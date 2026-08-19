/**
 * The closed corpus as the matcher sees it: names, sets, numbers, languages, variants.
 *
 * A snapshot, not a live query per title — the resolver is a pure function of this object.
 * Loading it never touches `copies`. Ownership is a later question, asked of a resolution,
 * never written by one.
 */

import type { MatcherCard, MatcherCorpus, MatcherVariant } from "../../shared/matcher.ts";
import type { GloomDatabase } from "../db/client.ts";
import { corpusCards, corpusSets, corpusVariants } from "../db/schema.ts";

export function loadMatcherCorpus(db: GloomDatabase): MatcherCorpus {
	const setRows = db.select().from(corpusSets).all();
	const abbreviationByKey = new Map(setRows.map((row) => [row.setKey, row.abbreviation] as const));

	const variantRows = db.select().from(corpusVariants).all();
	const variantsByCard = new Map<string, MatcherVariant[]>();
	for (const row of variantRows) {
		const list = variantsByCard.get(row.cardKey) ?? [];
		list.push({
			variantId: row.variantId,
			finish: row.finish,
			subtype: row.subtype,
			stamps: parseStamps(row.stamps),
			foil: row.foil,
			size: row.size,
		});
		variantsByCard.set(row.cardKey, list);
	}

	const cards: MatcherCard[] = db
		.select()
		.from(corpusCards)
		.all()
		.map((row) => ({
			cardKey: row.cardKey,
			language: row.language,
			cardId: row.cardId,
			setId: row.setId,
			setName: row.setName,
			setAbbreviation: abbreviationByKey.get(`${row.language}:${row.setId}`) ?? null,
			localId: row.localId,
			name: row.name,
			variants: sortVariants(variantsByCard.get(row.cardKey) ?? []),
		}))
		.sort((a, b) => (a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0));

	return { cards };
}

function parseStamps(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry): entry is string => typeof entry === "string")
			.slice()
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	} catch {
		return [];
	}
}

function sortVariants(variants: readonly MatcherVariant[]): MatcherVariant[] {
	return [...variants].sort((a, b) => {
		if (a.variantId < b.variantId) return -1;
		if (a.variantId > b.variantId) return 1;
		return 0;
	});
}
