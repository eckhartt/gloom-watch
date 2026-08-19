import { afterEach, describe, expect, it } from "vitest";
import {
	applyCopyCreateToBinder,
	applyCopyCreateToCompletion,
	applyCopyDisposeToBinder,
} from "../../client/collection.ts";
import {
	attemptPhotoUpload,
	writeAliasCreate,
	writeCopyCreate,
	writeMatchConfirm,
} from "../../client/writes.ts";
import type { BinderDocument } from "../../shared/contract.ts";
import type { CompletionDocument } from "../../shared/copies.ts";
import {
	aliasCreateMutation,
	copyCreateMutation,
	copyDisposeMutation,
	copyUpdateMutation,
	createMemoryKv,
	createOutboxStore,
	enqueue,
	isNetworkFailure,
	isPhotoMutation,
	matchConfirmMutation,
	PHOTO_KIND,
	PhotoNotOutboxEligibleError,
	photoUploadMutation,
	priorityMutation,
	replayOutbox,
	setDefaultOutboxStore,
	startOutboxPump,
} from "../../shared/outbox.ts";

const ID = "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e";
const SECOND = "1e3b8d51-7c2e-4d9f-8b22-6a1e3d4c5f60";
const GLOOM = { cardKey: "en:base2-44", variantId: "2fnyg4g532wu2uft0spaa3eefrz" };

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	setDefaultOutboxStore(createOutboxStore(createMemoryKv()));
});

describe("what the outbox will queue", () => {
	it("queues copy create, update, dispose, priority, match confirm and alias create", async () => {
		const store = createOutboxStore(createMemoryKv());
		const queued = [
			copyCreateMutation({ id: ID, ...GLOOM }),
			copyUpdateMutation(ID, { note: "off-centre" }),
			copyDisposeMutation(ID, { disposedAt: "2026-08-19" }),
			priorityMutation({ ...GLOOM, priority: 3 }),
			matchConfirmMutation("v1|123|0", { cardKey: GLOOM.cardKey }),
			aliasCreateMutation({ id: SECOND, pattern: "クサイハナ", cardKey: "ja:base2-44" }),
		];

		for (const mutation of queued) {
			await enqueue(store, mutation);
		}

		expect((await store.list()).map((entry) => entry.kind)).toEqual([
			"copy-create",
			"copy-update",
			"copy-dispose",
			"priority",
			"match-confirm",
			"alias-create",
		]);
	});

	it("replays in enqueue order and stops on the first failure", async () => {
		const store = createOutboxStore(createMemoryKv());
		await enqueue(store, copyCreateMutation({ id: ID, ...GLOOM }));
		await enqueue(store, copyCreateMutation({ id: SECOND, ...GLOOM }));

		const seen: string[] = [];
		const result = await replayOutbox(store, async (mutation) => {
			const id = (mutation.body as { id: string }).id;
			seen.push(id);
			if (id === SECOND) return { ok: false, status: 500, error: "boom" };
			return { ok: true, status: 201 };
		});

		expect(seen).toEqual([ID, SECOND]);
		expect(result.replayed).toBe(1);
		expect(result.failed?.lastError).toBe("boom");
		const remaining = await store.list();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.body).toMatchObject({ id: SECOND });
	});

	it("does not queue a photo mutation, and holds it with pending state instead", async () => {
		const store = createOutboxStore(createMemoryKv());
		const mutation = photoUploadMutation(ID, { blob: "not-going-in" });
		expect(isPhotoMutation(mutation)).toBe(true);
		expect(mutation.kind).toBe(PHOTO_KIND);

		await expect(enqueue(store, mutation)).rejects.toBeInstanceOf(PhotoNotOutboxEligibleError);
		expect(await store.list()).toEqual([]);
		expect(await store.photoHolds()).toHaveLength(1);
		expect((await store.photoHolds())[0]?.copyId).toBe(ID);
	});

	it("holds a photo attempted while offline without putting it on the outbox", async () => {
		const store = createOutboxStore(createMemoryKv());
		const result = await attemptPhotoUpload(ID, { store, online: false });
		expect(result.status).toBe("held");
		expect(await store.list()).toEqual([]);
		expect(await store.photoHolds()).toHaveLength(1);
	});

	it("does not hold a photo while online — there is no processor to send it to", async () => {
		const store = createOutboxStore(createMemoryKv());
		const result = await attemptPhotoUpload(ID, { store, online: true });
		expect(result.status).toBe("deferred");
		expect(await store.photoHolds()).toEqual([]);
	});
});

describe("a write that cannot reach the server", () => {
	it("queues the create and returns an optimistic copy", async () => {
		const store = createOutboxStore(createMemoryKv());
		globalThis.fetch = async () => {
			throw new TypeError("Failed to fetch");
		};

		const result = await writeCopyCreate({ id: ID, ...GLOOM, condition: "NM" }, { store });
		expect(result.queued).toBe(true);
		expect(result.value).toMatchObject({ id: ID, status: "owned", condition: "NM" });
		expect(await store.pendingCount()).toBe(1);
	});

	it("queues a match confirmation and an alias create the same way", async () => {
		const store = createOutboxStore(createMemoryKv());
		globalThis.fetch = async () => {
			throw new TypeError("Failed to fetch");
		};

		expect(
			(await writeMatchConfirm("v1|123|0", { cardKey: GLOOM.cardKey }, { store })).queued,
		).toBe(true);
		expect((await writeAliasCreate({ id: SECOND, pattern: "クサイハナ" }, { store })).queued).toBe(
			true,
		);
		expect((await store.list()).map((entry) => entry.kind)).toEqual([
			"match-confirm",
			"alias-create",
		]);
	});

	it("does not queue a validation error", async () => {
		const store = createOutboxStore(createMemoryKv());
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ error: "a grade needs a grader" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});

		await expect(writeCopyCreate({ id: ID, ...GLOOM, grade: 90 }, { store })).rejects.toThrow(
			/grader/,
		);
		expect(await store.list()).toEqual([]);
	});
});

describe("network failure detection", () => {
	it("treats a dropped fetch as a queueable failure and a 400 as not", () => {
		expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
		expect(isNetworkFailure(Object.assign(new Error("bad gateway"), { status: 502 }))).toBe(true);
		expect(
			isNetworkFailure(Object.assign(new Error("a grade needs a grader"), { status: 400 })),
		).toBe(false);
	});
});

describe("optimistic ownership", () => {
	const binder: BinderDocument = {
		generatedAt: 1,
		entries: [
			{
				key: `${GLOOM.cardKey} ${GLOOM.variantId}`,
				cardKey: GLOOM.cardKey,
				variantId: GLOOM.variantId,
				language: "en",
				setId: "base2",
				setName: "Jungle",
				setReleaseDate: "1999-06-16",
				localId: "44",
				name: "Gloom",
				rarity: "Uncommon",
				finish: "normal",
				subtype: null,
				stamps: [],
				foil: null,
				size: "standard",
				hasImage: true,
				missingUpstream: false,
				ownedCopies: 0,
				priority: 3,
			},
		],
	};

	it("marks the cell owned when a copy is recorded, and needed again when it is disposed", () => {
		const owned = applyCopyCreateToBinder(binder, GLOOM.cardKey, GLOOM.variantId);
		expect(owned.entries[0]?.ownedCopies).toBe(1);
		expect(
			applyCopyDisposeToBinder(owned, GLOOM.cardKey, GLOOM.variantId).entries[0]?.ownedCopies,
		).toBe(0);
	});

	it("raises completion only for the first owned copy of a variant", () => {
		const completion: CompletionDocument = {
			owned: 0,
			total: 10,
			missingUpstreamExcluded: 0,
		};
		const first = applyCopyCreateToCompletion(completion, {
			ownedCopies: 0,
			missingUpstream: false,
		});
		expect(first.owned).toBe(1);
		expect(
			applyCopyCreateToCompletion(first, { ownedCopies: 1, missingUpstream: false }).owned,
		).toBe(1);
	});
});

describe("the reconnect pump", () => {
	it("drains on the online event, in enqueue order", async () => {
		const store = createOutboxStore(createMemoryKv());
		await enqueue(store, copyCreateMutation({ id: ID, ...GLOOM }));
		await enqueue(store, copyUpdateMutation(ID, { note: "later" }));

		const order: string[] = [];
		const target = new EventTarget();
		const pump = startOutboxPump({
			store,
			target,
			immediate: false,
			transport: async (mutation) => {
				order.push(mutation.kind);
				return { ok: true, status: 200 };
			},
		});

		expect((await pump.drain())?.replayed).toBe(2);
		expect(order).toEqual(["copy-create", "copy-update"]);
		expect(await store.list()).toEqual([]);

		await enqueue(store, copyDisposeMutation(ID, { disposedAt: "2026-08-19" }));
		target.dispatchEvent(new Event("online"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(order).toEqual(["copy-create", "copy-update", "copy-dispose"]);
		pump.stop();
	});
});
