/**
 * The confirm queue. Three acts: accept the current resolution, pick a variant,
 * or mark the listing not a match. The first two teach an alias; only a variant
 * ruling may write a copy.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { CopyDocument } from "../../shared/copies.ts";
import type { QueueDocument, QueueResolutionDocument } from "../../shared/queue.ts";
import { QUEUE_PATH } from "../../shared/queue.ts";
import {
	cardExists,
	cardHasVariant,
	toAliasDocument,
	upsertAliasByPhrase,
} from "../aliases/repository.ts";
import { insertCopy, toCopyDocument } from "../copies/repository.ts";
import type { GloomDatabase } from "../db/client.ts";
import { listings } from "../db/schema.ts";
import { toListingDocument } from "../ebay/repository.ts";
import {
	countQueued,
	queueStateOf,
	readQueuedListingRows,
	readQueueState,
	toQueueItem,
	upsertQueueState,
} from "./repository.ts";
import {
	loadScoreContext,
	rescoreOpenQueue,
	scoreListing,
	scoreUnscoredListings,
} from "./score.ts";
import {
	copyFromRuling,
	InvalidQueueError,
	mintAliasId,
	parseConfirmRequest,
	parsePickVariantRequest,
} from "./validation.ts";

export interface QueueRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

const CACHE_CONTROL = "no-store";

export function createQueueRoutes(deps: QueueRouteDeps): Hono {
	const routes = new Hono();

	routes.get(QUEUE_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const now = deps.now();
		scoreUnscoredListings(deps.db, now);
		const ctx = loadScoreContext(deps.db, now);
		const rows = readQueuedListingRows(deps.db);
		// Rows already marked queued stay queued unless an alias pulled them off —
		// that rescore happens on alias write. This read just presents them.
		const body: QueueDocument = {
			generatedAt: now,
			depth: countQueued(deps.db),
			listings: rows.map(({ listing, state }) => {
				const document = toListingDocument(
					listing,
					now,
					ctx.corpus,
					ctx.aliases,
					queueStateOf(state),
				);
				return toQueueItem(document, document.match, ctx.owned);
			}),
		};
		return c.json(body);
	});

	routes.post(`${QUEUE_PATH}/:itemId/confirm`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		try {
			return c.json(await confirm(deps, c.req.param("itemId"), await readBody(c)));
		} catch (cause) {
			return reply(c, cause);
		}
	});

	routes.post(`${QUEUE_PATH}/:itemId/variant`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		try {
			return c.json(await pickVariant(deps, c.req.param("itemId"), await readBody(c)));
		} catch (cause) {
			return reply(c, cause);
		}
	});

	routes.post(`${QUEUE_PATH}/:itemId/reject`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		try {
			return c.json(await reject(deps, c.req.param("itemId")));
		} catch (cause) {
			return reply(c, cause);
		}
	});

	return routes;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		return {};
	}
}

function reply(
	c: { json: (body: { error: string }, status: 400 | 404 | 409) => Response },
	cause: unknown,
): Response {
	if (cause instanceof InvalidQueueError) return c.json({ error: cause.message }, 400);
	if (cause instanceof QueueHttpError) return c.json({ error: cause.message }, cause.status);
	throw cause;
}

class QueueHttpError extends Error {
	readonly status: 404 | 409;
	constructor(status: 404 | 409, message: string) {
		super(message);
		this.status = status;
	}
}

function requireListing(db: GloomDatabase, itemId: string, now: number) {
	const row = db.select().from(listings).where(eq(listings.itemId, itemId)).get();
	if (row === undefined) throw new QueueHttpError(404, "listing not found");
	const scored = scoreListing(db, itemId, loadScoreContext(db, now));
	if (scored.state === "not_a_match") {
		throw new QueueHttpError(409, "this listing was already marked not a match");
	}
	if (scored.state === "resolved") {
		return { row, scored, alreadyResolved: true as const };
	}
	if (scored.state !== "queued") {
		throw new QueueHttpError(409, `listing is ${scored.state}, not queued`);
	}
	return { row, scored, alreadyResolved: false as const };
}

function listingMatch(db: GloomDatabase, row: typeof listings.$inferSelect, now: number) {
	const ctx = loadScoreContext(db, now);
	return toListingDocument(row, now, ctx.corpus, ctx.aliases, "queued").match;
}

async function confirm(
	deps: QueueRouteDeps,
	itemId: string,
	body: unknown,
): Promise<QueueResolutionDocument> {
	const now = deps.now();
	const request = parseConfirmRequest(body);
	const { row, alreadyResolved } = requireListing(deps.db, itemId, now);
	if (alreadyResolved) return already(deps.db, itemId);

	const match = listingMatch(deps.db, row, now);
	const cardKey = request.cardKey ?? match.cardKey;
	if (cardKey === null) {
		throw new InvalidQueueError("confirming an unmatched listing needs a cardKey");
	}
	if (!cardExists(deps.db, cardKey)) {
		throw new QueueHttpError(404, "no such card in the masterset");
	}
	const variantId = request.variantId === undefined ? match.variantId : request.variantId;
	if (variantId !== null && !cardHasVariant(deps.db, cardKey, variantId)) {
		throw new QueueHttpError(404, "no such variant on that card");
	}

	const phrase = request.phrase ?? row.title;
	const alias = upsertAliasByPhrase(
		deps.db,
		{
			id: mintAliasId(request.aliasId),
			phrase,
			cardKey,
			variantId,
		},
		now,
	);
	upsertQueueState(deps.db, {
		itemId,
		state: "resolved",
		phrase,
		resolvedCardKey: cardKey,
		resolvedVariantId: variantId,
		updatedAt: now,
	});
	const copy = writeCopy(deps.db, request.recordCopy, cardKey, variantId, now);
	rescoreOpenQueue(deps.db, now);
	return resolution(itemId, phrase, cardKey, variantId, alias.row, copy);
}

async function pickVariant(
	deps: QueueRouteDeps,
	itemId: string,
	body: unknown,
): Promise<QueueResolutionDocument> {
	const now = deps.now();
	const request = parsePickVariantRequest(body);
	const { row, alreadyResolved } = requireListing(deps.db, itemId, now);
	if (alreadyResolved) return already(deps.db, itemId);

	const match = listingMatch(deps.db, row, now);
	const cardKey = match.cardKey;
	if (cardKey === null) {
		throw new InvalidQueueError("picking a variant needs a card-grain or variant-grain match");
	}
	if (!cardHasVariant(deps.db, cardKey, request.variantId)) {
		throw new QueueHttpError(404, "no such variant on that card");
	}

	const phrase = request.phrase ?? row.title;
	const alias = upsertAliasByPhrase(
		deps.db,
		{
			id: mintAliasId(request.aliasId),
			phrase,
			cardKey,
			variantId: request.variantId,
		},
		now,
	);
	upsertQueueState(deps.db, {
		itemId,
		state: "resolved",
		phrase,
		resolvedCardKey: cardKey,
		resolvedVariantId: request.variantId,
		updatedAt: now,
	});
	const copy = writeCopy(deps.db, request.recordCopy, cardKey, request.variantId, now);
	rescoreOpenQueue(deps.db, now);
	return resolution(itemId, phrase, cardKey, request.variantId, alias.row, copy);
}

async function reject(deps: QueueRouteDeps, itemId: string): Promise<QueueResolutionDocument> {
	const now = deps.now();
	const row = deps.db.select().from(listings).where(eq(listings.itemId, itemId)).get();
	if (row === undefined) throw new QueueHttpError(404, "listing not found");
	const scored = scoreListing(deps.db, itemId, loadScoreContext(deps.db, now));
	if (scored.state === "not_a_match") {
		return {
			itemId,
			queueState: "not_a_match",
			phrase: null,
			cardKey: null,
			variantId: null,
			alias: null,
			copy: null,
		};
	}
	if (scored.state === "resolved") {
		throw new QueueHttpError(409, "this listing was already resolved");
	}
	if (scored.state !== "queued") {
		throw new QueueHttpError(409, `listing is ${scored.state}, not queued`);
	}

	upsertQueueState(deps.db, {
		itemId,
		state: "not_a_match",
		phrase: null,
		resolvedCardKey: null,
		resolvedVariantId: null,
		updatedAt: now,
	});
	return {
		itemId,
		queueState: "not_a_match",
		phrase: null,
		cardKey: null,
		variantId: null,
		alias: null,
		copy: null,
	};
}

function writeCopy(
	db: GloomDatabase,
	recordCopy: unknown,
	cardKey: string,
	variantId: string | null,
	now: number,
): CopyDocument | null {
	if (recordCopy === undefined || recordCopy === null) return null;
	if (variantId === null) {
		throw new InvalidQueueError(
			"recording a copy needs a variant — the matcher will not guess one",
		);
	}
	const request = copyFromRuling(recordCopy as never, cardKey, variantId);
	if (request === undefined) return null;
	return toCopyDocument(insertCopy(db, request, now).row);
}

function already(db: GloomDatabase, itemId: string): QueueResolutionDocument {
	const state = readQueueState(db, itemId);
	if (state === null) throw new QueueHttpError(404, "listing not found");
	return {
		itemId,
		queueState: state.state === "not_a_match" ? "not_a_match" : "resolved",
		phrase: state.phrase,
		cardKey: state.resolvedCardKey,
		variantId: state.resolvedVariantId,
		alias: null,
		copy: null,
	};
}

function resolution(
	itemId: string,
	phrase: string,
	cardKey: string,
	variantId: string | null,
	alias: Parameters<typeof toAliasDocument>[0],
	copy: CopyDocument | null,
): QueueResolutionDocument {
	return {
		itemId,
		queueState: "resolved",
		phrase,
		cardKey,
		variantId,
		alias: toAliasDocument(alias),
		copy,
	};
}

/** Used by health. */
export function readConfirmQueueDepth(db: GloomDatabase): number {
	return countQueued(db);
}
