/**
 * The collection's HTTP surface: record a copy, edit one, dispose of one, read a variant's
 * purchase trail, read completion, set a priority.
 *
 * **There is no `DELETE`.** Not an oversight and not a gap to be filled later: disposal retains
 * the row, and a route that removed one would take the purchase history and the upgrade trail
 * with it. The only removal anywhere in this file clears a *priority*, which is a preference and
 * not a card.
 *
 * Every route here is one the outbox will replay in a later ticket, so each is either idempotent
 * by construction (the create, keyed on the client's UUID) or idempotent by nature (a patch, a
 * disposal that has already happened, a priority that is set to the value it already has).
 */

import { Hono } from "hono";
import type { CopyFields, CopyListDocument, PriorityDocument } from "../../shared/copies.ts";
import { COMPLETION_PATH, COPIES_PATH, PRIORITIES_PATH } from "../../shared/copies.ts";
import type { GloomDatabase } from "../db/client.ts";
import { readCompletion } from "./completion.ts";
import {
	disposeCopy,
	insertCopy,
	readCopy,
	readVariantCopies,
	readVariantPriority,
	setVariantPriority,
	toCopyDocument,
	updateCopy,
	variantExists,
} from "./repository.ts";
import {
	assertCopyInvariants,
	InvalidCopyError,
	parseCopyCreateRequest,
	parseCopyPatchRequest,
	parseDisposalRequest,
	parsePriorityRequest,
} from "./validation.ts";

export interface CopyRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

/**
 * Every route here is `no-store`.
 *
 * The binder is the cacheable document, revalidated on an ETag; these are the collection's write
 * surface and its live figures, and a phone holding a stale completion count after recording a
 * card would be reporting the opposite of what the owner just did.
 */
const CACHE_CONTROL = "no-store";

export function createCopyRoutes(deps: CopyRouteDeps): Hono {
	const routes = new Hono();

	routes.get(COPIES_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const cardKey = c.req.query("cardKey");
		const variantId = c.req.query("variantId");
		if (cardKey === undefined || variantId === undefined) {
			// Both halves or neither. A list keyed on `variantId` alone would answer with the copies
			// of up to 264 different cards, which is the collapse this whole design is built against.
			return c.json({ error: "cardKey and variantId are both required" }, 400);
		}
		const body: CopyListDocument = {
			copies: readVariantCopies(deps.db, cardKey, variantId).map(toCopyDocument),
		};
		return c.json(body);
	});

	routes.post(COPIES_PATH, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parseCopyCreateRequest(payload);
			if (!variantExists(deps.db, request.cardKey, request.variantId)) {
				return c.json({ error: "no such variant in the masterset" }, 404);
			}
			const { row, created } = insertCopy(deps.db, request, deps.now());
			// `200` on a replay rather than `201`: the second request created nothing, and the outbox
			// needs to be able to tell "already landed" from "landed just now" without guessing.
			return c.json(toCopyDocument(row), created ? 201 : 200);
		} catch (cause) {
			if (cause instanceof InvalidCopyError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	routes.patch(`${COPIES_PATH}/:id`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const existing = readCopy(deps.db, c.req.param("id"));
		if (existing === null) return c.json({ error: "no such copy" }, 404);

		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const patch = parseCopyPatchRequest(payload);
			// Checked against the copy the patch would produce, not against the patch. Adding a grade
			// to a copy that has no grader is exactly as wrong as creating one that way.
			const merged: CopyFields = { ...toCopyDocument(existing), ...patch };
			assertCopyInvariants(merged);
			const row = updateCopy(deps.db, existing.id, patch, deps.now());
			return c.json(toCopyDocument(row));
		} catch (cause) {
			if (cause instanceof InvalidCopyError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	routes.post(`${COPIES_PATH}/:id/disposal`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const existing = readCopy(deps.db, c.req.param("id"));
		if (existing === null) return c.json({ error: "no such copy" }, 404);

		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parseDisposalRequest(payload);
			const row = disposeCopy(deps.db, existing.id, request, deps.now());
			return c.json(toCopyDocument(row));
		} catch (cause) {
			if (cause instanceof InvalidCopyError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	routes.get(COMPLETION_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		return c.json(readCompletion(deps.db));
	});

	routes.put(PRIORITIES_PATH, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parsePriorityRequest(payload);
			if (!variantExists(deps.db, request.cardKey, request.variantId)) {
				return c.json({ error: "no such variant in the masterset" }, 404);
			}
			setVariantPriority(deps.db, request.cardKey, request.variantId, request.priority, deps.now());
			const body: PriorityDocument = {
				cardKey: request.cardKey,
				variantId: request.variantId,
				priority: readVariantPriority(deps.db, request.cardKey, request.variantId),
			};
			return c.json(body);
		} catch (cause) {
			if (cause instanceof InvalidCopyError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	return routes;
}
