import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The walking skeleton needs exactly one table: somewhere for the server to keep a handful of
 * small facts about itself that the phone can then render.
 *
 * `app_state` is a key/value store of server-owned scalars — the commissioning timezone, when
 * the database was first opened, when the cron job last ran. It is deliberately *not* named
 * `settings`: the spec's settings surface is a set of tunables the owner edits, and folding a
 * job heartbeat into that table would confuse configuration with health the moment either grows.
 *
 * Everything else in the spec — cards, variants, copies, photographs, listings, aliases — is a
 * later ticket and is not modelled here.
 */
export const appState = sqliteTable("app_state", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	/** UTC epoch milliseconds, per the spec's time convention. */
	updatedAt: integer("updated_at").notNull(),
});

export type AppStateRow = typeof appState.$inferSelect;
