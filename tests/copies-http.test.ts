import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import type { BinderDocument } from "../shared/contract.ts";
import { BINDER_PATH } from "../shared/contract.ts";
import type { CopyDocument, CopyListDocument } from "../shared/copies.ts";
import {
	COPIES_PATH,
	copyDisposalPath,
	copyPath,
	PRIORITIES_PATH,
	variantCopiesPath,
} from "../shared/copies.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The collection's routes, Hono's handlers against a real migrated database. The spec forbids
 * mocking the database and these are the seams every acceptance criterion runs through.
 */

const ID = "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e";
const SECOND = "1e3b8d51-7c2e-4d9f-8b22-6a1e3d4c5f60";
const GLOOM = { cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT };

describe("the collection's routes", () => {
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

	function post(server: ReturnType<typeof app>, path: string, body: unknown) {
		return server.request(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function patch(server: ReturnType<typeof app>, path: string, body: unknown) {
		return server.request(path, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function put(server: ReturnType<typeof app>, path: string, body: unknown) {
		return server.request(path, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("persists every field a copy carries", async () => {
		// The criterion, one field at a time: condition, grader, grade, cert number, price with
		// currency, the home-currency snapshot with its rate date, acquisition source and note.
		const server = app();
		const response = await post(server, COPIES_PATH, {
			id: ID,
			...GLOOM,
			condition: "LP",
			grader: "PSA",
			grade: 85,
			certNo: "48219930",
			priceMinor: 62_000,
			currency: "JPY",
			priceHomeMinor: 61_250,
			homeCurrency: "AUD",
			rateDate: "2026-02-11",
			acquiredAt: "2026-02-10",
			sourceType: "ebay",
			sourceNote: "a Tokyo seller with good feedback",
			note: "slightly off-centre, front only",
		});

		expect(response.status).toBe(201);
		const copy = (await response.json()) as CopyDocument;
		expect(copy).toMatchObject({
			id: ID,
			condition: "LP",
			grader: "PSA",
			// Tenths, so `PSA 8.5` compares exactly against a grade parsed off a listing title.
			grade: 85,
			certNo: "48219930",
			// ¥62,000 — the yen has no minor unit, so this is 62000 and not 6,200,000.
			priceMinor: 62_000,
			currency: "JPY",
			priceHomeMinor: 61_250,
			homeCurrency: "AUD",
			rateDate: "2026-02-11",
			acquiredAt: "2026-02-10",
			sourceType: "ebay",
			sourceNote: "a Tokyo seller with good feedback",
			note: "slightly off-centre, front only",
			status: "owned",
		});

		// Read back from the database rather than from the response, so this is persistence and
		// not an echo.
		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		const held = ((await list.json()) as CopyListDocument).copies;
		expect(held).toHaveLength(1);
		expect(held[0]?.certNo).toBe("48219930");
		expect(held[0]?.note).toBe("slightly off-centre, front only");
	});

	it("refuses a grade with no grader", async () => {
		const response = await post(app(), COPIES_PATH, { id: ID, ...GLOOM, grade: 90 });
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toContain("grader");
	});

	it("refuses a home-currency amount with no currency or no rate date", async () => {
		const server = app();
		const noCurrency = await post(server, COPIES_PATH, {
			id: ID,
			...GLOOM,
			priceHomeMinor: 4500,
			rateDate: "2026-02-11",
		});
		expect(noCurrency.status).toBe(400);

		const noDate = await post(server, COPIES_PATH, {
			id: SECOND,
			...GLOOM,
			priceHomeMinor: 4500,
			homeCurrency: "AUD",
		});
		expect(noDate.status).toBe(400);
		expect(((await noDate.json()) as { error: string }).error).toContain("rate");
	});

	it("refuses a grade that looks like it was typed in points rather than tenths", async () => {
		// `9` meaning PSA 9 would otherwise store 0.9 — plausible, silent, and a tenth of what was
		// meant. No grader on the list issues anything below 1.0, so the range catches it.
		const response = await post(app(), COPIES_PATH, {
			id: ID,
			...GLOOM,
			grader: "PSA",
			grade: 9,
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toContain("tenths");
	});

	it("refuses a price with no currency", async () => {
		const response = await post(app(), COPIES_PATH, { id: ID, ...GLOOM, priceMinor: 1250 });
		expect(response.status).toBe(400);
	});

	it("refuses a fractional amount of minor units", async () => {
		// A float is exactly what integer minor units exist to keep out.
		const response = await post(app(), COPIES_PATH, {
			id: ID,
			...GLOOM,
			priceMinor: 12.5,
			currency: "AUD",
		});
		expect(response.status).toBe(400);
	});

	it("refuses an identifier the client did not mint as a UUID", async () => {
		// The identifier being the client's is what makes an outbox replay idempotent. A server
		// that accepted `1` would be accepting one the client cannot reproduce after a reload.
		const response = await post(app(), COPIES_PATH, { id: "1", ...GLOOM });
		expect(response.status).toBe(400);
	});

	it("refuses a copy of a variant that is not in the masterset", async () => {
		const response = await post(app(), COPIES_PATH, {
			id: ID,
			cardKey: "en:base2-44",
			variantId: "no-such-printing",
		});
		expect(response.status).toBe(404);
	});

	it("answers a replayed create with the same row and a 200 rather than a second card", async () => {
		const server = app();
		const body = { id: ID, ...GLOOM, condition: "NM" };

		const first = await post(server, COPIES_PATH, body);
		const second = await post(server, COPIES_PATH, body);

		expect(first.status).toBe(201);
		// `200`, not `201`: the outbox needs to tell "already landed" from "landed just now".
		expect(second.status).toBe(200);
		expect((await second.json()) as CopyDocument).toMatchObject({ id: ID });

		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		expect(((await list.json()) as CopyListDocument).copies).toHaveLength(1);
	});

	it("edits a copy, and refuses an edit that would leave a grade with no grader", async () => {
		const server = app();
		await post(server, COPIES_PATH, { id: ID, ...GLOOM, grader: "PSA", grade: 90 });

		const edited = await patch(server, copyPath(ID), { grade: 95, note: "regraded" });
		expect(edited.status).toBe(200);
		expect((await edited.json()) as CopyDocument).toMatchObject({ grade: 95, note: "regraded" });

		// Checked against the copy the patch would *produce*, not against the patch: removing the
		// grader while leaving the grade is exactly as wrong as creating one that way.
		const orphaned = await patch(server, copyPath(ID), { grader: null });
		expect(orphaned.status).toBe(400);
	});

	it("refuses to change status through the edit route", async () => {
		// Disposal is its own act with its own route, so nothing that looks like correcting a typo
		// can quietly take a card out of the collection.
		const server = app();
		await post(server, COPIES_PATH, { id: ID, ...GLOOM });

		const response = await patch(server, copyPath(ID), { status: "disposed" });
		expect(response.status).toBe(400);
	});

	it("disposes of a copy, keeps its row and drops it out of the binder's ownership", async () => {
		const server = app();
		await post(server, COPIES_PATH, { id: ID, ...GLOOM, priceMinor: 4500, currency: "AUD" });

		const before = (await (await server.request(BINDER_PATH)).json()) as BinderDocument;
		expect(
			before.entries.find((entry) => entry.key === `${GLOOM.cardKey} ${GLOOM.variantId}`)
				?.ownedCopies,
		).toBe(1);

		const disposed = await post(server, copyDisposalPath(ID), {
			disposedAt: "2026-06-07",
			disposalKind: "traded",
		});
		expect(disposed.status).toBe(200);
		expect((await disposed.json()) as CopyDocument).toMatchObject({
			status: "disposed",
			disposedAt: "2026-06-07",
			disposalKind: "traded",
			// What it cost survives. That is why the row is retained rather than deleted.
			priceMinor: 4500,
		});

		const after = (await (await server.request(BINDER_PATH)).json()) as BinderDocument;
		expect(
			after.entries.find((entry) => entry.key === `${GLOOM.cardKey} ${GLOOM.variantId}`)
				?.ownedCopies,
		).toBe(0);

		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		expect(((await list.json()) as CopyListDocument).copies).toHaveLength(1);
	});

	it("refuses a disposal with no date", async () => {
		const server = app();
		await post(server, COPIES_PATH, { id: ID, ...GLOOM });

		const response = await post(server, copyDisposalPath(ID), { disposalKind: "sold" });
		expect(response.status).toBe(400);
	});

	it("changes the binder's ETag when a copy is recorded", async () => {
		// The service worker holds the binder document and revalidates on this token, so a copy
		// that did not move it would leave the phone showing a card as needed indefinitely.
		const server = app();
		const before = (await server.request(BINDER_PATH)).headers.get("etag");

		await post(server, COPIES_PATH, { id: ID, ...GLOOM });

		expect((await server.request(BINDER_PATH)).headers.get("etag")).not.toBe(before);
	});

	it("lists a variant's copies only when told which card as well as which printing", async () => {
		// `variant_id` alone is shared by 264 cards in the live corpus, so half an identity would
		// answer with somebody else's collection.
		const response = await app().request(`${COPIES_PATH}?variantId=${SHARED_VARIANT}`);
		expect(response.status).toBe(400);
	});

	it("sets a priority on an unowned variant and reads it back off the binder", async () => {
		const server = app();
		const response = await put(server, PRIORITIES_PATH, { ...GLOOM, priority: 3 });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ...GLOOM, priority: 3 });

		const binder = (await (await server.request(BINDER_PATH)).json()) as BinderDocument;
		const entry = binder.entries.find((e) => e.key === `${GLOOM.cardKey} ${GLOOM.variantId}`);
		expect(entry?.priority).toBe(3);
		expect(entry?.ownedCopies).toBe(0);

		// The other card sharing that printing's `variant_id` is untouched.
		const sibling = binder.entries.find((e) => e.key === `en:base1-45 ${SHARED_VARIANT}`);
		expect(sibling?.priority).toBeNull();
	});

	it("clears a priority on null, since 0 is a real rung", async () => {
		const server = app();
		await put(server, PRIORITIES_PATH, { ...GLOOM, priority: 0 });
		expect(
			((await (await server.request(BINDER_PATH)).json()) as BinderDocument).entries.find(
				(e) => e.key === `${GLOOM.cardKey} ${GLOOM.variantId}`,
			)?.priority,
		).toBe(0);

		await put(server, PRIORITIES_PATH, { ...GLOOM, priority: null });
		expect(
			((await (await server.request(BINDER_PATH)).json()) as BinderDocument).entries.find(
				(e) => e.key === `${GLOOM.cardKey} ${GLOOM.variantId}`,
			)?.priority,
		).toBeNull();
	});

	it("refuses a priority outside 0–3", async () => {
		const response = await put(app(), PRIORITIES_PATH, { ...GLOOM, priority: 7 });
		expect(response.status).toBe(400);
	});

	it("offers no way to delete a copy", async () => {
		// Stated as a test because it is a design rule rather than an omission: disposal retains
		// the row, and a delete would take the purchase history and the upgrade trail with it.
		const server = app();
		await post(server, COPIES_PATH, { id: ID, ...GLOOM });

		const response = await server.request(copyPath(ID), { method: "DELETE" });
		expect(response.status).not.toBe(200);

		const list = await server.request(variantCopiesPath(GLOOM.cardKey, GLOOM.variantId));
		expect(((await list.json()) as CopyListDocument).copies).toHaveLength(1);
	});
});
