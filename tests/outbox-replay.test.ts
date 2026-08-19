import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import type { CopyListDocument } from "../shared/copies.ts";
import { variantCopiesPath } from "../shared/copies.ts";
import {
	copyCreateMutation,
	createMemoryKv,
	createOutboxStore,
	createTransport,
	enqueue,
	replayMutation,
	replayOutbox,
} from "../shared/outbox.ts";
import { FIRST_EDITION_VARIANT, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The outbox's replay against a real HTTP app and a real database.
 *
 * The spec names this test: replaying the same client-generated UUID twice yields one row.
 * The replay function is the shipped one — this file does not reimplement it.
 */

const ID = "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e";
const GLOOM = { cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT };

describe("outbox replay against the collection routes", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		let clock = 1_800_000_000_000;
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => (clock += 1_000),
		});
	}

	it("replaying the same client-generated id twice yields one row", async () => {
		const server = app();
		const store = createOutboxStore(createMemoryKv());
		const transport = createTransport((path, init) => server.request(path, init));
		const mutation = copyCreateMutation({ id: ID, ...GLOOM, condition: "NM" });

		await enqueue(store, mutation);
		const first = await replayMutation(mutation, transport);
		const second = await replayMutation(mutation, transport);

		expect(first).toEqual({ ok: true, status: 201 });
		expect(second).toEqual({ ok: true, status: 200 });

		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		const copies = ((await list.json()) as CopyListDocument).copies;
		expect(copies).toHaveLength(1);
		expect(copies[0]?.id).toBe(ID);
	});

	it("a failed replay keeps the mutation in the outbox", async () => {
		const store = createOutboxStore(createMemoryKv());
		await enqueue(store, copyCreateMutation({ id: ID, ...GLOOM }));

		const failing = createTransport(async () => {
			throw new TypeError("Failed to fetch");
		});
		const result = await replayOutbox(store, failing);

		expect(result.replayed).toBe(0);
		expect(result.failed).not.toBeNull();
		const remaining = await store.list();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.lastError).toMatch(/Failed to fetch/);
		expect(remaining[0]?.body).toMatchObject({ id: ID });
	});

	it("drains a queued create into the database in one row, even if drained twice", async () => {
		const server = app();
		const store = createOutboxStore(createMemoryKv());
		const transport = createTransport((path, init) => server.request(path, init));

		await enqueue(store, copyCreateMutation({ id: ID, ...GLOOM, condition: "LP" }));
		expect((await replayOutbox(store, transport)).replayed).toBe(1);
		expect((await replayOutbox(store, transport)).replayed).toBe(0);

		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		expect(((await list.json()) as CopyListDocument).copies).toHaveLength(1);
	});
});
