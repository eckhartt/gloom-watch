/**
 * The collection's HTTP surface: record a copy, edit one, dispose of one, attach a photograph,
 * read a variant's purchase trail, read completion, set a priority.
 *
 * **There is no `DELETE` for a copy.** Disposal retains the row, and a route that removed one
 * would take the purchase history and the upgrade trail with it. Photographs are the other kind
 * of record: they can be deleted, because a file is not a purchase history. The only other
 * removal in this file clears a *priority*, which is a preference and not a card.
 *
 * Every route here except photograph delete is one the outbox replays, so each is either
 * idempotent by construction (the create, keyed on the client's UUID) or idempotent by nature
 * (a patch, a disposal that has already happened, a priority set to the value it already has).
 */

import { Hono } from "hono";
import type {
	CopyFields,
	CopyListDocument,
	PhotographListDocument,
	PriorityDocument,
} from "../../shared/copies.ts";
import {
	COMPLETION_PATH,
	COPIES_PATH,
	PHOTOGRAPHS_PATH,
	PRIORITIES_PATH,
} from "../../shared/copies.ts";
import type { GloomDatabase } from "../db/client.ts";
import { readCompletion } from "./completion.ts";
import {
	copyExists,
	deletePhotograph,
	insertPhotograph,
	readCopyPhotographs,
	readPhotograph,
	toPhotographDocument,
} from "./photographs.ts";
import {
	InvalidPhotographError,
	PHOTOGRAPH_MAX_UPLOAD_BYTES,
	processPhotograph,
} from "./process-photograph.ts";
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

const CLIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

	routes.get(`${COPIES_PATH}/:id/photographs`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		if (!copyExists(deps.db, c.req.param("id"))) {
			return c.json({ error: "no such copy" }, 404);
		}
		const body: PhotographListDocument = {
			photographs: readCopyPhotographs(deps.db, c.req.param("id")).map(toPhotographDocument),
		};
		return c.json(body);
	});

	routes.post(`${COPIES_PATH}/:id/photographs`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const copyId = c.req.param("id");
		if (!copyExists(deps.db, copyId)) {
			return c.json({ error: "no such copy" }, 404);
		}

		try {
			const upload = await readPhotographUpload(c);
			const existing = readPhotograph(deps.db, upload.id);
			if (existing !== null) {
				// Replay of the same create. A UUID pointing at a different copy is a client bug,
				// not a second photograph — refuse rather than echo the wrong row.
				if (existing.copyId !== copyId) {
					return c.json({ error: "that photograph already belongs to a different copy" }, 409);
				}
				return c.json(toPhotographDocument(existing), 200);
			}

			const processed = await processPhotograph(upload.bytes);
			const { row, created } = insertPhotograph(
				deps.db,
				{ id: upload.id, copyId, processed },
				deps.now(),
			);
			return c.json(toPhotographDocument(row), created ? 201 : 200);
		} catch (cause) {
			if (cause instanceof InvalidPhotographError) {
				return c.json({ error: cause.message }, 400);
			}
			throw cause;
		}
	});

	routes.get(`${PHOTOGRAPHS_PATH}/:id`, (c) => {
		const row = readPhotograph(deps.db, c.req.param("id"));
		if (row === null) return c.json({ error: "no such photograph" }, 404);

		const bytes = new Uint8Array(row.imageBytes);
		c.header("Content-Type", row.imageContentType);
		c.header("Cache-Control", "private, max-age=31536000, immutable");
		c.header("Content-Length", String(bytes.byteLength));
		return c.body(bytes);
	});

	routes.delete(`${PHOTOGRAPHS_PATH}/:id`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		if (!deletePhotograph(deps.db, c.req.param("id"))) {
			return c.json({ error: "no such photograph" }, 404);
		}
		return c.body(null, 204);
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

async function readPhotographUpload(c: {
	req: {
		header: (name: string) => string | undefined;
		parseBody: () => Promise<Record<string, string | File>>;
	};
}): Promise<{ id: string; bytes: Uint8Array }> {
	const contentType = c.req.header("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		throw new InvalidPhotographError("a photograph is uploaded as multipart form data");
	}

	const body = await c.req.parseBody();
	const id = body.id;
	if (typeof id !== "string" || !CLIENT_UUID.test(id)) {
		throw new InvalidPhotographError("id must be a UUID minted by the client");
	}

	const file = body.file;
	if (!(file instanceof File)) {
		throw new InvalidPhotographError("file is required");
	}
	if (file.size > PHOTOGRAPH_MAX_UPLOAD_BYTES) {
		throw new InvalidPhotographError("that photograph is too large to store");
	}

	return { id, bytes: new Uint8Array(await file.arrayBuffer()) };
}
