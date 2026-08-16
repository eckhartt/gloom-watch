import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { buildBinderDocument } from "../server/binder/document.ts";
import { readOwnedCopyCounts } from "../server/binder/ownership.ts";
import { DEFAULT_CLIENT_DIR, REPO_ROOT, resolveFromRepo } from "../server/config.ts";
import { readCompletion } from "../server/copies/completion.ts";
import { disposeCopy, insertCopy, readVariantCopies } from "../server/copies/repository.ts";
import { BINDER_PATH } from "../shared/contract.ts";
import { COMPLETION_PATH, variantCopiesPath } from "../shared/copies.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { isSelect, predicateOf, readsCopies, type SqlSpy, spyOnSql } from "./helpers/sql-spy.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * **Every ownership query filters on owned status.**
 *
 * The criterion asks for a test that would fail *if one query did not filter* — a test that
 * catches the class, not one assertion per query. A list of queries is precisely the thing that
 * cannot do that: the query nobody added to the list is the one that will be wrong, and the
 * failure is silent, plausible and permanent (a card the owner sold quietly counted as held, and
 * a completion figure that is simply too high).
 *
 * Three things close the class between them, in order of how much they actually prove:
 *
 * 1. **Every statement the application issues** is captured from the connection and held to one
 *    rule: a read of `copies` names the statuses it wants. Written by any module, present or
 *    future, exercised through the HTTP surface.
 * 2. **The table is reachable from two modules.** A new ownership query cannot be written
 *    somewhere this test does not look, because nothing else may import the table at all.
 * 3. **A collection where every copy is disposed reads as empty**, end to end. A forgotten filter
 *    shows up as a card the owner does not have.
 */

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const DISPOSED_ID = "33333333-3333-4333-8333-333333333333";

describe("every ownership query filters on owned status", () => {
	let temp: TempDatabase;
	let spy: SqlSpy | null = null;

	beforeEach(() => {
		temp = createTempDatabase();
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		spy?.stop();
		spy = null;
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => 1_800_000_000_000,
		});
	}

	function seedCopies() {
		insertCopy(
			temp.handle.db,
			{ id: OWNER_ID, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		insertCopy(
			temp.handle.db,
			{ id: SECOND_ID, cardKey: "en:base1-45", variantId: SHARED_VARIANT },
			1,
		);
		insertCopy(
			temp.handle.db,
			{ id: DISPOSED_ID, cardKey: "en:base2-44", variantId: SHARED_VARIANT },
			1,
		);
		disposeCopy(temp.handle.db, DISPOSED_ID, { disposedAt: "2026-01-02" }, 2);
	}

	it("issues no read of the copies table that does not say which statuses it wants", async () => {
		// The class test. Nothing here names a query: it exercises the surface and then holds every
		// statement that came out of it to the rule. A new ownership query written anywhere, by
		// anyone, that forgets `status` fails this the first time its code path runs.
		seedCopies();

		spy = spyOnSql(temp.handle);
		const server = app();
		await server.request(BINDER_PATH);
		await server.request(COMPLETION_PATH);
		await server.request(variantCopiesPath("en:base2-44", SHARED_VARIANT));
		buildBinderDocument({ db: temp.handle.db, now: () => 1 });
		readCompletion(temp.handle.db);
		readOwnedCopyCounts(temp.handle.db);
		readVariantCopies(temp.handle.db, "en:base2-44", SHARED_VARIANT);

		const reads = spy.statements.filter((sql) => isSelect(sql) && readsCopies(sql));
		// If this is ever zero the test has stopped testing anything — the surface moved and the
		// statements are no longer flowing through here.
		expect(reads.length).toBeGreaterThan(0);

		for (const statement of reads) {
			expect(predicateOf(statement), statement).toContain('"status"');
		}
	});

	it("keeps the copies table reachable from two modules, so a new query cannot hide", () => {
		// Half two of the class. The statement rule can only judge code that ran; this one stops a
		// query being written where no test would ever exercise it. The allowance is deliberately
		// small: the one ownership query, and the repository that owns the table's history reads
		// and its writes.
		const allowed = ["server/binder/ownership.ts", "server/copies/repository.ts"];
		const importers = serverFiles().filter((file) =>
			importsCopiesTable(readFileSync(join(REPO_ROOT, file), "utf8")),
		);

		// Both halves, so this cannot pass by matching nothing at all. An assertion that only ever
		// says "no offenders" is green the day its own regex stops working.
		expect(importers.toSorted()).toEqual(allowed.toSorted());
	});

	it("reports an empty collection when every copy has been disposed of", async () => {
		// The behavioural half, and the one that would actually be noticed: a database holding
		// nothing but sold cards must read as a collection of nothing, on every surface at once.
		seedCopies();
		for (const id of [OWNER_ID, SECOND_ID]) {
			disposeCopy(temp.handle.db, id, { disposedAt: "2026-02-03", disposalKind: "sold" }, 3);
		}

		expect(readOwnedCopyCounts(temp.handle.db).size).toBe(0);
		expect(readCompletion(temp.handle.db).owned).toBe(0);

		const binder = await app().request(BINDER_PATH);
		const body = (await binder.json()) as { entries: { ownedCopies: number }[] };
		expect(body.entries.every((entry) => entry.ownedCopies === 0)).toBe(true);

		const completion = await app().request(COMPLETION_PATH);
		expect(((await completion.json()) as { owned: number }).owned).toBe(0);

		// And the rows are all still there. Disposal retains them; that is the whole reason the
		// filter has to exist rather than the delete doing this job for free.
		const trail = readVariantCopies(temp.handle.db, "en:base2-44", FIRST_EDITION_VARIANT);
		expect(trail).toHaveLength(1);
		expect(trail[0]?.status).toBe("disposed");
	});
});

/** Every TypeScript file under `server/`, as repository-relative paths. */
function serverFiles(): string[] {
	const walk = (relative: string): string[] =>
		readdirSync(join(REPO_ROOT, relative), { withFileTypes: true }).flatMap((entry) => {
			const path = `${relative}/${entry.name}`;
			if (entry.isDirectory()) return walk(path);
			return entry.name.endsWith(".ts") ? [path] : [];
		});
	return walk("server").filter((file) => file !== "server/db/schema.ts");
}

/**
 * Whether a module pulls the `copies` table itself out of the schema — which is the only way to
 * write SQL against it. Matched on the import rather than on the word, so a comment mentioning
 * copies is not an offence.
 */
function importsCopiesTable(source: string): boolean {
	for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*db\/schema\.ts"/g)) {
		const names = (match[1] ?? "").split(",").map((name) => name.trim());
		if (names.includes("copies")) return true;
	}
	return false;
}
