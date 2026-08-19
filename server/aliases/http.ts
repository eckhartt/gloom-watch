/**
 * Aliases as their own resource: list, create, edit, delete.
 *
 * Delete is allowed here — an alias is a mapping, not a card. Clearing a wrong
 * phrase is how the owner undoes a confirm that taught the wrong wording.
 */

import { Hono } from "hono";
import type { AliasListDocument } from "../../shared/queue.ts";
import { ALIASES_PATH } from "../../shared/queue.ts";
import type { GloomDatabase } from "../db/client.ts";
import { rescoreOpenQueue } from "../queue/score.ts";
import {
	InvalidQueueError,
	parseAliasCreateRequest,
	parseAliasPatchRequest,
} from "../queue/validation.ts";
import {
	cardExists,
	cardHasVariant,
	deleteAlias,
	insertAlias,
	readAlias,
	readAliasByPhrase,
	readAliases,
	toAliasDocument,
	updateAlias,
} from "./repository.ts";

export interface AliasRouteDeps {
	readonly db: GloomDatabase;
	readonly now: () => number;
}

const CACHE_CONTROL = "no-store";

export function createAliasRoutes(deps: AliasRouteDeps): Hono {
	const routes = new Hono();

	routes.get(ALIASES_PATH, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const body: AliasListDocument = {
			aliases: readAliases(deps.db).map(toAliasDocument),
		};
		return c.json(body);
	});

	routes.post(ALIASES_PATH, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}
		try {
			const request = parseAliasCreateRequest(payload);
			if (!cardExists(deps.db, request.cardKey)) {
				return c.json({ error: "no such card in the masterset" }, 404);
			}
			if (
				request.variantId !== null &&
				request.variantId !== undefined &&
				!cardHasVariant(deps.db, request.cardKey, request.variantId)
			) {
				return c.json({ error: "no such variant on that card" }, 404);
			}
			const clash = readAliasByPhrase(deps.db, request.phrase);
			if (clash !== null && clash.id !== request.id) {
				return c.json({ error: "another alias already uses that phrase" }, 409);
			}
			const { row, created } = insertAlias(
				deps.db,
				{
					id: request.id,
					phrase: request.phrase,
					cardKey: request.cardKey,
					variantId: request.variantId ?? null,
				},
				deps.now(),
			);
			if (created) rescoreOpenQueue(deps.db, deps.now());
			return c.json(toAliasDocument(row), created ? 201 : 200);
		} catch (cause) {
			if (cause instanceof InvalidQueueError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	routes.patch(`${ALIASES_PATH}/:id`, async (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		const existing = readAlias(deps.db, c.req.param("id"));
		if (existing === null) return c.json({ error: "no such alias" }, 404);
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}
		try {
			const patch = parseAliasPatchRequest(payload);
			const cardKey = patch.cardKey ?? existing.cardKey;
			const variantId = "variantId" in patch ? (patch.variantId ?? null) : existing.variantId;
			if (!cardExists(deps.db, cardKey)) {
				return c.json({ error: "no such card in the masterset" }, 404);
			}
			if (variantId !== null && !cardHasVariant(deps.db, cardKey, variantId)) {
				return c.json({ error: "no such variant on that card" }, 404);
			}
			if (patch.phrase !== undefined) {
				const clash = readAliasByPhrase(deps.db, patch.phrase);
				if (clash !== null && clash.id !== existing.id) {
					return c.json({ error: "another alias already uses that phrase" }, 409);
				}
			}
			const row = updateAlias(deps.db, existing.id, patch, deps.now());
			rescoreOpenQueue(deps.db, deps.now());
			return c.json(toAliasDocument(row));
		} catch (cause) {
			if (cause instanceof InvalidQueueError) return c.json({ error: cause.message }, 400);
			throw cause;
		}
	});

	routes.delete(`${ALIASES_PATH}/:id`, (c) => {
		c.header("Cache-Control", CACHE_CONTROL);
		if (!deleteAlias(deps.db, c.req.param("id"))) {
			return c.json({ error: "no such alias" }, 404);
		}
		rescoreOpenQueue(deps.db, deps.now());
		return c.body(null, 204);
	});

	return routes;
}
