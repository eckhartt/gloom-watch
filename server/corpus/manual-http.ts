/**
 * Owner-facing write surface for hand-added variants and the exclusion list.
 *
 * Route shapes are the builder's choice. The constraints are the spec's: client-minted UUIDs
 * so a replay is idempotent, identities in the reserved `manual:` namespace, and a re-import
 * that never touches these rows. Sync is a different file; this one is the only writer.
 */

import { Hono } from "hono";
import type { CorpusExclusionListDocument } from "../../shared/manual.ts";
import { CORPUS_EXCLUSIONS_PATH, MANUAL_VARIANTS_PATH } from "../../shared/manual.ts";
import type { GloomDatabase } from "../db/client.ts";
import {
	deleteExclusion,
	deleteManualVariant,
	InvalidManualError,
	insertManualVariant,
	parseExclusionUpsert,
	parseManualCreateRequest,
	parseManualPatchRequest,
	readExclusionsList,
	updateManualVariant,
	upsertExclusion,
} from "./manual.ts";

export interface ManualRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

const CACHE_CONTROL = "no-store";

export function createManualRoutes(deps: ManualRouteDeps): Hono {
	const routes = new Hono();

	routes.post(MANUAL_VARIANTS_PATH, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parseManualCreateRequest(payload);
			const { document, created } = insertManualVariant(deps.db, request, deps.now());
			return c.json(document, created ? 201 : 200);
		} catch (cause) {
			if (cause instanceof InvalidManualError) {
				return c.json({ error: cause.message }, cause.status);
			}
			throw cause;
		}
	});

	routes.patch(`${MANUAL_VARIANTS_PATH}/:cardKey/:variantId`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const patch = parseManualPatchRequest(payload);
			const document = updateManualVariant(
				deps.db,
				c.req.param("cardKey"),
				c.req.param("variantId"),
				patch,
				deps.now(),
			);
			return c.json(document);
		} catch (cause) {
			if (cause instanceof InvalidManualError) {
				return c.json({ error: cause.message }, cause.status);
			}
			throw cause;
		}
	});

	routes.delete(`${MANUAL_VARIANTS_PATH}/:cardKey/:variantId`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		try {
			deleteManualVariant(deps.db, c.req.param("cardKey"), c.req.param("variantId"), deps.now());
			return c.body(null, 204);
		} catch (cause) {
			if (cause instanceof InvalidManualError) {
				return c.json({ error: cause.message }, cause.status);
			}
			throw cause;
		}
	});

	routes.get(CORPUS_EXCLUSIONS_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const body: CorpusExclusionListDocument = { exclusions: readExclusionsList(deps.db) };
		return c.json(body);
	});

	routes.put(CORPUS_EXCLUSIONS_PATH, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		try {
			const request = parseExclusionUpsert(payload);
			return c.json(upsertExclusion(deps.db, request.cardKey, request.reason, deps.now()));
		} catch (cause) {
			if (cause instanceof InvalidManualError) {
				return c.json({ error: cause.message }, cause.status);
			}
			throw cause;
		}
	});

	routes.delete(`${CORPUS_EXCLUSIONS_PATH}/:cardKey`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const removed = deleteExclusion(deps.db, c.req.param("cardKey"));
		if (!removed) return c.json({ error: "no such exclusion" }, 404);
		return c.body(null, 204);
	});

	return routes;
}
