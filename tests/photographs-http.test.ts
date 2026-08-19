import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { PHOTOGRAPH_CONTENT_TYPE } from "../server/copies/process-photograph.ts";
import type { PhotographDocument, PhotographListDocument } from "../shared/copies.ts";
import { COPIES_PATH, copyPhotographsPath, photographPath } from "../shared/copies.ts";
import { FIRST_EDITION_VARIANT, seedBinderCorpus } from "./helpers/binder-fixture.ts";
import { GPS_EXIF_MARKER, jpegWithGpsExif } from "./helpers/gps-jpeg.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * Attaching and deleting photographs through the real routes, against a real migrated database.
 * The EXIF guarantee is the same one `process-photograph.test.ts` holds of the transform; this
 * file holds it of the HTTP surface, because that is what the phone hits.
 */

const COPY_ID = "0f2a9c40-6b1d-4c8e-9a11-5f0f2c3b4d5e";
const PHOTO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_PHOTO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GLOOM = { cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT };

describe("owner photograph routes", () => {
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

	async function recordCopy(server: ReturnType<typeof app>): Promise<void> {
		const response = await server.request(COPIES_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: COPY_ID, ...GLOOM, condition: "NM" }),
		});
		expect(response.status).toBe(201);
	}

	async function attach(
		server: ReturnType<typeof app>,
		id: string,
		bytes: Uint8Array,
		filename = "card.jpg",
	): Promise<Response> {
		const body = new FormData();
		body.set("id", id);
		body.set("file", new File([new Uint8Array(bytes)], filename, { type: "image/jpeg" }));
		return server.request(copyPhotographsPath(COPY_ID), { method: "POST", body });
	}

	it("attaches a photograph, stores webp, and strips GPS EXIF from the blob the route serves", async () => {
		const jpeg = await jpegWithGpsExif(2000, 1400);
		expect(Buffer.from(jpeg).includes(Buffer.from(GPS_EXIF_MARKER, "ascii"))).toBe(true);

		const server = app();
		await recordCopy(server);

		const created = await attach(server, PHOTO_ID, jpeg);
		expect(created.status).toBe(201);
		const document = (await created.json()) as PhotographDocument;
		expect(document).toMatchObject({
			id: PHOTO_ID,
			copyId: COPY_ID,
			contentType: PHOTOGRAPH_CONTENT_TYPE,
		});
		expect(Math.max(document.width, document.height)).toBe(1600);
		expect(document.byteSize).toBeGreaterThan(0);

		const listed = await server.request(copyPhotographsPath(COPY_ID));
		expect(listed.status).toBe(200);
		const list = (await listed.json()) as PhotographListDocument;
		expect(list.photographs).toHaveLength(1);
		expect(list.photographs[0]?.id).toBe(PHOTO_ID);

		const blob = await server.request(photographPath(PHOTO_ID));
		expect(blob.status).toBe(200);
		expect(blob.headers.get("content-type")).toBe(PHOTOGRAPH_CONTENT_TYPE);
		const stored = Buffer.from(await blob.arrayBuffer());
		expect(stored.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(stored.includes(Buffer.from(GPS_EXIF_MARKER, "ascii"))).toBe(false);
		expect(stored.includes(Buffer.from("Exif", "ascii"))).toBe(false);
		expect(stored.byteLength).toBe(document.byteSize);
	});

	it("attaches more than one photograph to the same copy", async () => {
		const server = app();
		await recordCopy(server);
		const jpeg = await jpegWithGpsExif();

		expect((await attach(server, PHOTO_ID, jpeg)).status).toBe(201);
		expect((await attach(server, SECOND_PHOTO, jpeg)).status).toBe(201);

		const listed = await server.request(copyPhotographsPath(COPY_ID));
		const ids = ((await listed.json()) as PhotographListDocument).photographs.map((p) => p.id);
		expect(ids).toEqual([PHOTO_ID, SECOND_PHOTO]);
	});

	it("answers a replayed attach with the same row and a 200 rather than a second photograph", async () => {
		const server = app();
		await recordCopy(server);
		const jpeg = await jpegWithGpsExif();

		const first = await attach(server, PHOTO_ID, jpeg);
		const second = await attach(server, PHOTO_ID, jpeg);
		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect(((await second.json()) as PhotographDocument).id).toBe(PHOTO_ID);

		const listed = await server.request(copyPhotographsPath(COPY_ID));
		expect(((await listed.json()) as PhotographListDocument).photographs).toHaveLength(1);
	});

	it("deletes a photograph and then 404s the blob", async () => {
		const server = app();
		await recordCopy(server);
		const jpeg = await jpegWithGpsExif();
		expect((await attach(server, PHOTO_ID, jpeg)).status).toBe(201);

		const deleted = await server.request(photographPath(PHOTO_ID), { method: "DELETE" });
		expect(deleted.status).toBe(204);
		expect(await deleted.text()).toBe("");

		const missing = await server.request(photographPath(PHOTO_ID));
		expect(missing.status).toBe(404);
		expect(((await missing.json()) as { error: string }).error).toBe("no such photograph");

		const listed = await server.request(copyPhotographsPath(COPY_ID));
		expect(((await listed.json()) as PhotographListDocument).photographs).toHaveLength(0);
	});

	it("refuses an attach whose identifier is not a client-minted UUID", async () => {
		const server = app();
		await recordCopy(server);
		const jpeg = await jpegWithGpsExif();
		const response = await attach(server, "1", jpeg);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toContain("UUID");
	});

	it("404s an attach to a copy that does not exist", async () => {
		const jpeg = await jpegWithGpsExif();
		const body = new FormData();
		body.set("id", PHOTO_ID);
		body.set("file", new File([new Uint8Array(jpeg)], "card.jpg", { type: "image/jpeg" }));
		const response = await app().request(copyPhotographsPath(COPY_ID), { method: "POST", body });
		expect(response.status).toBe(404);
	});
});
