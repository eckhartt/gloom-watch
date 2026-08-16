/**
 * The corpus sync, as a job.
 *
 * Pressing sync writes a `corpus_sync_jobs` row and returns; this runs on afterwards, updating
 * that row as it goes. Nothing here holds an HTTP connection open, and every scrap of progress
 * is in SQLite rather than in memory, so the phone can poll it and a restart leaves a record
 * that is true rather than a job frozen at "running" forever.
 *
 * Six phases:
 *
 * ```
 * languages   derive the language list from upstream, never hard-coded
 * brief       per language, the whole brief list + the per-species dex index, stored
 * detail      membership filtered LOCALLY over that store; detail fetched for survivors only
 * sets        one request per (language, set) the detail phase just confirmed, for its
 *             release date — the binder's default order, stored nowhere else
 * images      one webp BLOB per card, re-fetched only when the datas.json hash moved
 * reconcile   anything upstream no longer carries is flagged missing_upstream — never deleted
 * ```
 *
 * The sets phase sits **after** detail deliberately: it runs over the `(language, set_id)` pairs
 * the cards actually landed on, which is 137 pairs against the live corpus rather than the 506
 * a cross-product of 46 sets and 11 languages would suggest.
 */

import { randomUUID } from "node:crypto";
import { APP_STATE_KEYS, readAppState, writeAppState } from "../db/app-state.ts";
import type { GloomDatabase } from "../db/client.ts";
import type { UnknownAxisValue } from "./ingest.ts";
import { normaliseCard } from "./ingest.ts";
import { type MembershipCandidate, ODDISH_LINE_DEX_IDS, selectMembers } from "./membership.ts";
import {
	type BriefUpsert,
	countVariants,
	createSyncJob,
	flagMissingUpstream,
	flagSetMissingUpstream,
	planSetFetches,
	readBriefRecords,
	readExclusions,
	readImageCandidates,
	replaceBriefSnapshot,
	type SetFetchTarget,
	type SyncJobPatch,
	updateSyncJob,
	upsertCard,
	upsertSet,
	variantKeyOf,
	writeCardImage,
} from "./repository.ts";
import {
	buildImageUrl,
	type ImageManifest,
	lookupImageHash,
	parseImageLocation,
	type TcgdexClient,
	type TcgdexSetDetail,
} from "./tcgdex.ts";

export interface CorpusSyncDeps {
	readonly db: GloomDatabase;
	readonly client: TcgdexClient;
	/** Injected so tests drive time without a global clock mock. */
	readonly now?: () => number;
	/** Parallel upstream requests. Kept low deliberately: this is somebody else's free API. */
	readonly concurrency?: number;
	/** Pause between requests inside one worker, in milliseconds. */
	readonly pauseMs?: number;
	readonly log?: (message: string) => void;
}

export interface CorpusSyncSummary {
	readonly jobId: string;
	readonly status: "succeeded" | "failed";
	readonly languagesDerived: readonly string[];
	readonly languagesSynced: readonly string[];
	readonly briefRecords: number;
	readonly members: number;
	readonly cardsUpserted: number;
	readonly variantsUpserted: number;
	readonly cardsFlaggedMissing: number;
	readonly variantsFlaggedMissing: number;
	readonly imagesFetched: number;
	readonly imagesUnchanged: number;
	readonly imageBytesFetched: number;
	readonly setsFetched: number;
	readonly setsUnchanged: number;
	readonly setsFlaggedMissing: number;
	readonly unknownAxisValues: readonly UnknownAxisValue[];
	readonly variantCountBefore: number;
	readonly variantCountAfter: number;
	readonly failures: readonly string[];
	readonly error: string | null;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PAUSE_MS = 40;
/** How often progress is written back. Every item would be a write per fetch for no benefit. */
const PROGRESS_EVERY = 10;

function sleep(ms: number): Promise<void> {
	return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

async function forEachWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let next = 0;
	const runners: Promise<void>[] = [];
	for (let i = 0; i < Math.min(limit, items.length); i++) {
		runners.push(
			(async () => {
				for (;;) {
					const index = next++;
					if (index >= items.length) return;
					const item = items[index];
					if (item === undefined) return;
					await worker(item, index);
				}
			})(),
		);
	}
	await Promise.all(runners);
}

/** Mint a job row and hand back its id. The caller starts the work; the row is already visible. */
export function beginCorpusSync(db: GloomDatabase, now: number): string {
	const id = randomUUID();
	createSyncJob(db, id, now);
	return id;
}

export async function runCorpusSync(
	deps: CorpusSyncDeps,
	jobId: string,
): Promise<CorpusSyncSummary> {
	const { db, client } = deps;
	const now = deps.now ?? (() => Date.now());
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
	const log = deps.log ?? (() => {});

	const patch = (values: SyncJobPatch): void => {
		updateSyncJob(db, jobId, values, now());
	};

	const failures: string[] = [];
	const unknownAxisValues: UnknownAxisValue[] = [];
	const variantCountBefore = countVariants(db);
	patch({ variantCountBefore });

	let languages: string[] = [];
	let briefRecordCount = 0;
	let members: MembershipCandidate[] = [];
	let cardsUpserted = 0;
	let variantsUpserted = 0;
	let imagesFetched = 0;
	let imagesUnchanged = 0;
	let imageBytesFetched = 0;
	let setsFetched = 0;
	let setsUnchanged = 0;
	let setsFlaggedMissing = 0;
	let flagged = { cards: 0, variants: 0 };
	const syncedLanguages: string[] = [];

	try {
		/* ---- languages ------------------------------------------------------ */
		patch({ phase: "languages", message: "deriving the language list", processed: 0, total: null });
		languages = await client.listLanguages();
		log(`languages: ${languages.join(" ")}`);

		/* ---- brief ---------------------------------------------------------- */
		patch({ phase: "brief", processed: 0, total: languages.length, message: null });
		let done = 0;
		for (const language of languages) {
			try {
				const upserts = await fetchBriefSnapshot(client, language, pauseMs);
				replaceBriefSnapshot(db, language, upserts, now());
				briefRecordCount += upserts.length;
				syncedLanguages.push(language);
				log(`brief ${language}: ${upserts.length} records`);
			} catch (error) {
				// One language failing must not lose the other seventeen, and must not let the
				// reconcile phase conclude that its whole corpus vanished.
				failures.push(`brief ${language}: ${describe(error)}`);
			}
			patch({ processed: ++done, message: `brief list: ${language}` });
		}
		if (syncedLanguages.length === 0) {
			throw new Error(`no language could be fetched (${failures.join("; ")})`);
		}

		/* ---- detail --------------------------------------------------------- */
		const exclusions = readExclusions(db);
		const briefRecords = readBriefRecords(db).filter((record) =>
			syncedLanguages.includes(record.language),
		);
		members = selectMembers(briefRecords, { excluded: exclusions });
		log(`membership: ${members.length} of ${briefRecords.length} brief records`);
		patch({ phase: "detail", processed: 0, total: members.length, message: null });

		const seenCardKeys = new Set<string>();
		const seenVariantKeys = new Set<string>();
		const failedDetailLanguages = new Set<string>();
		let detailDone = 0;

		await forEachWithConcurrency(members, concurrency, async (member) => {
			try {
				const detail = await client.getCard(member.language, member.cardId);
				if (detail !== null) {
					const result = normaliseCard(member.language, detail, member.reason);
					unknownAxisValues.push(...result.unknownAxisValues);
					if (result.card !== null) {
						const counts = upsertCard(db, result.card, now());
						cardsUpserted += counts.cards;
						variantsUpserted += counts.variants;
						seenCardKeys.add(result.card.cardKey);
						for (const variant of result.card.variants) {
							seenVariantKeys.add(variantKeyOf(result.card.cardKey, variant.variantId));
						}
					}
				}
			} catch (error) {
				failedDetailLanguages.add(member.language);
				failures.push(`detail ${member.language}/${member.cardId}: ${describe(error)}`);
			}
			detailDone++;
			if (detailDone % PROGRESS_EVERY === 0 || detailDone === members.length) {
				patch({ processed: detailDone, cardsUpserted, variantsUpserted });
			}
			await sleep(pauseMs);
		});

		/* ---- sets ----------------------------------------------------------- */
		// Scoped to the languages whose detail actually completed, for the same reason the image
		// and reconcile phases are: a language upstream failed on must not have its sets chased,
		// and must certainly not have them flagged as having vanished.
		const reconcilable = syncedLanguages.filter((language) => !failedDetailLanguages.has(language));
		patch({ phase: "sets", processed: 0, total: null, message: "planning set fetches" });
		const setResult = await syncSets(deps, jobId, reconcilable, now, patch);
		setsFetched = setResult.fetched;
		setsUnchanged = setResult.unchanged;
		setsFlaggedMissing = setResult.flaggedMissing;
		failures.push(...setResult.failures);

		/* ---- images --------------------------------------------------------- */
		patch({ phase: "images", processed: 0, total: null, message: "reading the hash manifest" });
		const imageResult = await syncImages(deps, jobId, reconcilable, now, patch);
		imagesFetched = imageResult.fetched;
		imagesUnchanged = imageResult.unchanged;
		imageBytesFetched = imageResult.bytes;
		failures.push(...imageResult.failures);

		/* ---- reconcile ------------------------------------------------------ */
		patch({ phase: "reconcile", processed: 0, total: null, message: "flagging vanished rows" });
		flagged = flagMissingUpstream(db, reconcilable, seenCardKeys, seenVariantKeys, now());

		const variantCountAfter = countVariants(db);
		const finishedAt = now();
		patch({
			status: "succeeded",
			phase: "done",
			finishedAt,
			message:
				failures.length === 0
					? "sync complete"
					: `sync complete with ${failures.length} failure(s)`,
			error: failures.length === 0 ? null : failures.slice(0, 20).join("\n"),
			languagesSynced: JSON.stringify(reconcilable),
			cardsUpserted,
			variantsUpserted,
			cardsFlaggedMissing: flagged.cards,
			variantsFlaggedMissing: flagged.variants,
			imagesFetched,
			imagesUnchanged,
			imageBytesFetched,
			setsFetched,
			setsUnchanged,
			setsFlaggedMissing,
			unknownAxisValues: JSON.stringify(summariseUnknown(unknownAxisValues)),
			variantCountAfter,
		});

		return {
			jobId,
			status: "succeeded",
			languagesDerived: languages,
			languagesSynced: reconcilable,
			briefRecords: briefRecordCount,
			members: members.length,
			cardsUpserted,
			variantsUpserted,
			cardsFlaggedMissing: flagged.cards,
			variantsFlaggedMissing: flagged.variants,
			imagesFetched,
			imagesUnchanged,
			imageBytesFetched,
			setsFetched,
			setsUnchanged,
			setsFlaggedMissing,
			unknownAxisValues,
			variantCountBefore,
			variantCountAfter,
			failures,
			error: null,
		};
	} catch (error) {
		const message = describe(error);
		patch({
			status: "failed",
			phase: "done",
			finishedAt: now(),
			error: message,
			message: "sync failed",
			variantCountAfter: countVariants(db),
		});
		return {
			jobId,
			status: "failed",
			languagesDerived: languages,
			languagesSynced: syncedLanguages,
			briefRecords: briefRecordCount,
			members: members.length,
			cardsUpserted,
			variantsUpserted,
			cardsFlaggedMissing: flagged.cards,
			variantsFlaggedMissing: flagged.variants,
			imagesFetched,
			imagesUnchanged,
			imageBytesFetched,
			setsFetched,
			setsUnchanged,
			setsFlaggedMissing,
			unknownAxisValues,
			variantCountBefore,
			variantCountAfter: countVariants(db),
			failures,
			error: message,
		};
	}
}

/**
 * The brief list for one language, with dex numbers attached.
 *
 * `/v2/{lang}/cards` returns `{id, localId, name, image}` and no `dexId`, so the dex half of
 * membership needs one narrow request per species. Note `eq:` — the default filter is a
 * *contains* match, and a bare `dexId=43` returns 403 English cards where 32 are wanted,
 * because 431 contains 43.
 */
async function fetchBriefSnapshot(
	client: TcgdexClient,
	language: string,
	pauseMs: number,
): Promise<BriefUpsert[]> {
	const briefs = await client.listCards(language);
	await sleep(pauseMs);

	const dexIds = new Map<string, number[]>();
	for (const dexId of ODDISH_LINE_DEX_IDS) {
		for (const card of await client.listCardsByDexId(language, dexId)) {
			const existing = dexIds.get(card.id);
			if (existing === undefined) dexIds.set(card.id, [dexId]);
			else if (!existing.includes(dexId)) existing.push(dexId);
		}
		await sleep(pauseMs);
	}

	const upserts = new Map<string, BriefUpsert>();
	for (const card of briefs) {
		upserts.set(card.id, {
			cardId: card.id,
			localId: String(card.localId),
			name: card.name,
			dexIds: dexIds.get(card.id) ?? [],
			imageBase: card.image ?? null,
		});
	}
	// A dex hit absent from the brief list would otherwise be lost. Not observed, but the two
	// come from different queries and only one of them is exhaustive.
	for (const [cardId, ids] of dexIds) {
		if (!upserts.has(cardId)) {
			upserts.set(cardId, { cardId, localId: "", name: "", dexIds: ids, imageBase: null });
		}
	}
	return [...upserts.values()];
}

interface SetSyncResult {
	readonly fetched: number;
	readonly unchanged: number;
	readonly flaggedMissing: number;
	readonly failures: readonly string[];
}

/**
 * The sets phase: one request per set the corpus references and has no release date for.
 *
 * The date is the whole point. `/v2/{lang}/sets/{setId}` is the only endpoint that carries it,
 * there is no bulk form and no conditional-fetch story, so the cost is one request per set —
 * 137 on a first sync against the live corpus, zero on a re-sync of an unchanged one.
 *
 * The response also carries the set's entire `cards` array, which is ignored: the corpus already
 * holds every card it wants and re-reading them here would be a second, disagreeing source.
 *
 * **A 404 flags rather than deletes**, consistent with how the corpus treats every other upstream
 * disappearance. A set the owner holds cards from cannot be allowed to take those cards' ordering
 * with it because upstream renamed an ID.
 */
async function syncSets(
	deps: CorpusSyncDeps,
	jobId: string,
	languages: readonly string[],
	now: () => number,
	patch: (values: SyncJobPatch) => void,
): Promise<SetSyncResult> {
	const { db, client } = deps;
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
	const log = deps.log ?? (() => {});
	const failures: string[] = [];

	const plan = planSetFetches(db, languages);
	patch({
		processed: 0,
		total: plan.wanted.length,
		message: `${plan.wanted.length} set(s) to fetch, ${plan.satisfied} already dated`,
	});
	log(`sets: ${plan.wanted.length} to fetch, ${plan.satisfied} already dated`);

	let fetched = 0;
	let flaggedMissing = 0;
	let done = 0;

	await forEachWithConcurrency(plan.wanted, concurrency, async (target) => {
		try {
			const detail = await client.getSet(target.language, target.setId);
			if (detail === null) {
				flagSetMissingUpstream(db, target, now());
				flaggedMissing++;
			} else {
				upsertSet(db, normaliseSet(target, detail), now());
				fetched++;
			}
		} catch (error) {
			// A transport failure is not a disappearance. The row is left as it is and the next
			// sync asks again, because `planSetFetches` still finds no release date for it.
			failures.push(`set ${target.language}/${target.setId}: ${describe(error)}`);
		}
		done++;
		if (done % PROGRESS_EVERY === 0 || done === plan.wanted.length) {
			updateSyncJob(
				db,
				jobId,
				{ processed: done, setsFetched: fetched, setsFlaggedMissing: flaggedMissing },
				now(),
			);
		}
		await sleep(pauseMs);
	});

	return { fetched, unchanged: plan.satisfied, flaggedMissing, failures };
}

/**
 * `TcgdexSetDetail → SetUpsert`.
 *
 * `releaseDate` is stored **verbatim as the ISO `YYYY-MM-DD` string upstream sends**. Parsing it
 * into a `Date` and back would move `1999-06-16` by a day for anybody east or west of UTC, and
 * the spec is explicit that a calendar date is not an instant.
 *
 * `abbreviation` arrives as `{official?, localized?}` and is frequently absent; only the
 * official form is kept, since the localised one duplicates the set name in most languages.
 */
function normaliseSet(target: SetFetchTarget, detail: TcgdexSetDetail) {
	const releaseDate =
		typeof detail.releaseDate === "string" && detail.releaseDate !== "" ? detail.releaseDate : null;
	return {
		setKey: target.setKey,
		language: target.language,
		setId: target.setId,
		name: detail.name ?? null,
		releaseDate,
		serieId: detail.serie?.id ?? null,
		serieName: detail.serie?.name ?? null,
		abbreviation: detail.abbreviation?.official ?? null,
		cardCountTotal: detail.cardCount?.total ?? null,
	};
}

interface ImageSyncResult {
	readonly fetched: number;
	readonly unchanged: number;
	readonly bytes: number;
	readonly failures: readonly string[];
}

/**
 * Incremental image sync, driven by the hash manifest.
 *
 * `datas.json` is ~6.4 MB and is keyed `language → series → set → localId → hash`, **not** by
 * card ID, so the coordinates are read back out of the card's own image URL. It carries an
 * ETag, which is the only conditional-fetch story available: a 304 means nothing upstream moved
 * and the previously stored hashes stand, so an unchanged corpus re-syncs its images for the
 * cost of one conditional request.
 */
async function syncImages(
	deps: CorpusSyncDeps,
	jobId: string,
	languages: readonly string[],
	now: () => number,
	patch: (values: SyncJobPatch) => void,
): Promise<ImageSyncResult> {
	const { db, client } = deps;
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
	const failures: string[] = [];

	const cachedEtag = readAppState(db, APP_STATE_KEYS.corpusImageManifestEtag);
	const result = await client.fetchImageManifest(cachedEtag);
	if (result.etag !== null && result.etag !== cachedEtag) {
		writeAppState(db, APP_STATE_KEYS.corpusImageManifestEtag, result.etag, now());
	}
	const manifest: ImageManifest | null = result.manifest;

	const candidates = readImageCandidates(db, languages);
	const wanted = candidates.flatMap((candidate) => {
		const location = parseImageLocation(candidate.imageBase);
		if (location === null) return [];
		// A 304 leaves us without a manifest; the stored hash is then still current, so only a
		// card holding no bytes at all needs fetching.
		const hash = manifest === null ? candidate.imageHash : lookupImageHash(manifest, location);
		if (hash === null) return [];
		if (candidate.hasBytes && candidate.imageHash === hash) return [];
		return [{ cardKey: candidate.cardKey, url: buildImageUrl(candidate.imageBase), hash }];
	});

	patch({ processed: 0, total: wanted.length, message: `${wanted.length} image(s) to fetch` });

	let fetched = 0;
	let bytes = 0;
	let done = 0;
	await forEachWithConcurrency(wanted, concurrency, async (item) => {
		try {
			const image = await client.fetchImage(item.url);
			if (image !== null) {
				writeCardImage(
					db,
					{
						cardKey: item.cardKey,
						hash: item.hash,
						bytes: image.bytes,
						contentType: image.contentType,
					},
					now(),
				);
				fetched++;
				bytes += image.bytes.byteLength;
			}
		} catch (error) {
			failures.push(`image ${item.cardKey}: ${describe(error)}`);
		}
		done++;
		if (done % PROGRESS_EVERY === 0 || done === wanted.length) {
			updateSyncJob(
				db,
				jobId,
				{ processed: done, imagesFetched: fetched, imageBytesFetched: bytes },
				now(),
			);
		}
		await sleep(pauseMs);
	});

	return { fetched, unchanged: candidates.length - wanted.length, bytes, failures };
}

/** Counts by axis and raw value, so the job row carries a summary rather than thousands of rows. */
function summariseUnknown(
	values: readonly UnknownAxisValue[],
): { axis: string; raw: string; canonical: string; count: number }[] {
	const counts = new Map<string, { axis: string; raw: string; canonical: string; count: number }>();
	for (const value of values) {
		const key = `${value.axis} ${value.raw}`;
		const existing = counts.get(key);
		if (existing === undefined) {
			counts.set(key, { axis: value.axis, raw: value.raw, canonical: value.canonical, count: 1 });
		} else {
			existing.count++;
		}
	}
	return [...counts.values()].sort((a, b) => b.count - a.count);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
