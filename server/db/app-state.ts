import { eq, sql } from "drizzle-orm";
import type { GloomDatabase } from "./client.ts";
import { appState } from "./schema.ts";

/**
 * The server-owned scalars. Kept as a frozen map rather than loose strings so a typo is a type
 * error rather than a silently absent row.
 */
export const APP_STATE_KEYS = {
	/** UTC epoch ms — when this database was first opened by the server. Written once. */
	installedAt: "installed_at",
	/** IANA timezone name, set at commissioning. */
	timezone: "timezone",
	/** UTC epoch ms — last run of the OS-level cron heartbeat, from its own process. */
	lastHeartbeatAt: "last_heartbeat_at",
	/**
	 * ETag of TCGdex's `datas.json` image hash manifest as last fetched. The manifest is ~6.4 MB
	 * and is keyed by set nesting rather than by card, so it has no per-card conditional-fetch
	 * story; its ETag is the whole of the story at the manifest level, and a 304 means no card
	 * image anywhere has moved.
	 */
	corpusImageManifestEtag: "corpus_image_manifest_etag",
	/**
	 * How many forward-scan cycles have completed (successfully or not). DE and AU run when
	 * this is divisible by four. Incremented at the start of each cycle so a crash mid-scan
	 * still counts — otherwise a failing cycle would retry DE/AU forever.
	 */
	scanCycleCount: "scan_cycle_count",
} as const;

export type AppStateKey = (typeof APP_STATE_KEYS)[keyof typeof APP_STATE_KEYS];

export function readAppState(db: GloomDatabase, key: AppStateKey): string | null {
	const row = db.select().from(appState).where(eq(appState.key, key)).get();
	return row?.value ?? null;
}

export function readAppStateNumber(db: GloomDatabase, key: AppStateKey): number | null {
	const raw = readAppState(db, key);
	if (raw === null) return null;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : null;
}

/** Last write wins. One user, one device — the spec says that is sufficient. */
export function writeAppState(
	db: GloomDatabase,
	key: AppStateKey,
	value: string,
	now: number,
): void {
	db.insert(appState)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({
			target: appState.key,
			set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
		})
		.run();
}

/** Write only if absent, so a boot never overwrites a value the owner has since changed. */
export function seedAppState(
	db: GloomDatabase,
	key: AppStateKey,
	value: string,
	now: number,
): void {
	db.insert(appState).values({ key, value, updatedAt: now }).onConflictDoNothing().run();
}

/**
 * First-boot seeding. `installed_at` records when this database was first opened; `timezone`
 * takes its commissioning value from the environment and is the database's thereafter, because
 * the spec makes it an owner-editable setting rather than a deployment detail.
 */
export function seedInitialState(db: GloomDatabase, defaultTimezone: string, now: number): void {
	seedAppState(db, APP_STATE_KEYS.installedAt, String(now), now);
	seedAppState(db, APP_STATE_KEYS.timezone, defaultTimezone, now);
}
