import { defineConfig } from "drizzle-kit";

/**
 * `generate` only — never `push`. `strict: true` makes drizzle-kit ask before it emits
 * anything destructive, and SQLite's 12-step table rebuild is where data silently vanishes,
 * so every generated `.sql` is read before it is committed. The `drizzle/meta` snapshots are
 * the diff baseline and are committed with it.
 *
 * `drizzle-kit` must be invoked through `bun --bun`, or it reaches for `better-sqlite3` and
 * fails; see the `db:generate` and `db:check` scripts.
 */
export default defineConfig({
	dialect: "sqlite",
	schema: "./server/db/schema.ts",
	out: "./drizzle",
	strict: true,
	verbose: true,
	dbCredentials: {
		url: process.env.GLOOM_WATCH_DB ?? "./data/gloom-watch.db",
	},
});
