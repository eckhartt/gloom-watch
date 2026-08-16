/**
 * Every SQL statement the application actually issues, captured from the connection.
 *
 * This exists for one acceptance criterion — *every ownership query filters on owned status,
 * verified by a test that would fail if one did not* — which asks for a test that catches the
 * **class** rather than one test per query. Listing the queries and asserting about each is
 * exactly what the criterion rules out: the next query nobody thought to add to the list is the
 * one that will be wrong.
 *
 * So instead of asking the code what it meant to do, this watches what it did. Drizzle's
 * `bun-sqlite` driver prepares every statement through `client.prepare`, so shadowing that one
 * method on the instance sees all of them, whichever module built them and whether or not this
 * test knew the module existed.
 */

import type { DatabaseHandle } from "../../server/db/client.ts";

export interface SqlSpy {
	/** Every statement prepared since the spy was attached, in order. */
	readonly statements: readonly string[];
	stop(): void;
}

interface PreparingConnection {
	prepare: (sql: string, ...rest: unknown[]) => unknown;
}

export function spyOnSql(handle: DatabaseHandle): SqlSpy {
	const statements: string[] = [];
	const connection = handle.sqlite as unknown as PreparingConnection;
	const original = connection.prepare.bind(handle.sqlite);

	connection.prepare = (sql: string, ...rest: unknown[]) => {
		statements.push(sql);
		return original(sql, ...rest);
	};

	return {
		statements,
		stop() {
			connection.prepare = original;
		},
	};
}

/** Whether a statement reads rows rather than writing them or defining a table. */
export function isSelect(statement: string): boolean {
	return statement.trimStart().toLowerCase().startsWith("select");
}

/** Whether a statement reads the copies table, as opposed to merely mentioning the word. */
export function readsCopies(statement: string): boolean {
	return /\bfrom\s+"copies"|\bjoin\s+"copies"/i.test(statement);
}

/**
 * Everything after the select list — the `FROM`, the predicates and the grouping.
 *
 * The select list is cut away deliberately. `select "status" from "copies"` *mentions* the
 * column and constrains nothing, and a check that could not tell those apart would pass the
 * exact query this is here to catch.
 */
export function predicateOf(statement: string): string {
	const from = statement.toLowerCase().indexOf(" from ");
	return from === -1 ? statement : statement.slice(from);
}
