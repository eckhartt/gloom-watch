import {
	blob,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { PUSH_TRANSPORTS } from "../../shared/push.ts";

/**
 * `app_state` is a key/value store of server-owned scalars — the commissioning timezone, when
 * the database was first opened, when the cron job last ran, the ETag of the image manifest.
 * It is deliberately *not* named `settings`: the spec's settings surface is a set of tunables
 * the owner edits, and folding a job heartbeat into that table would confuse configuration with
 * health the moment either grows.
 *
 * Copies, photographs, listings and aliases are later tickets and are not modelled here.
 */
export const appState = sqliteTable("app_state", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	/** UTC epoch milliseconds, per the spec's time convention. */
	updatedAt: integer("updated_at").notNull(),
});

export type AppStateRow = typeof appState.$inferSelect;

/**
 * The push subscriptions this origin has issued.
 *
 * **The server is the source of truth for what subscriptions exist; it cannot know which are
 * live.** `pushsubscriptionchange` is not implemented on iOS and the absence of a `410` is not
 * evidence of life, so this table is a record of what was registered, not of what will arrive.
 * The re-enable button on the phone is what actually recovers a dead one.
 *
 * `endpoint` is the natural identity — it is what the push service issued and what a re-subscribe
 * returns unchanged — so it carries the unique index and a repeated registration updates in place.
 * `id` is a separate opaque identifier because the echo log points at it and because rows the
 * client can create carry client-generated identifiers by convention, so a replayed create yields
 * one row.
 *
 * A subscription is **retired, not deleted**, when the push service says it is gone. Deleting it
 * would take its echo-log history with it, and that history is the only after-the-fact evidence
 * available for a transport whose failures are invisible on the device.
 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
	id: text("id").primaryKey(),
	endpoint: text("endpoint").notNull().unique(),
	/** The device's P-256 public key, base64url. Half of the RFC 8291 key agreement. */
	p256dh: text("p256dh").notNull(),
	/** The device's auth secret, base64url. The other half. */
	auth: text("auth").notNull(),
	/**
	 * Which payload shape this device can render, captured by the client at subscribe time.
	 * `declarative` is exempt from the silent-push penalty; `classic` is iOS 16.4–18.3.
	 */
	transport: text("transport", { enum: PUSH_TRANSPORTS }).notNull(),
	/** UTC epoch ms from `PushSubscription.expirationTime`. Null on iOS, which never sets it. */
	expirationTime: integer("expiration_time"),
	/** The owner's own device, so this is not third-party data. It tells one handset from another. */
	userAgent: text("user_agent"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
	/** UTC epoch ms of the last push the push service accepted. Acceptance, not delivery. */
	lastSuccessAt: integer("last_success_at"),
	/** UTC epoch ms when a 404 or 410 proved this endpoint gone. Retired rows are never sent to. */
	retiredAt: integer("retired_at"),
	/** The status that retired it, so a surprise (say a 403) is distinguishable from an expiry. */
	retiredStatus: integer("retired_status"),
});

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * Every push this server has sent, its size and what the push service said.
 *
 * **This observes the send side only.** The dangerous failure — a worker that does not display
 * the notification and burns a silent-push strike — happens on the device and produces no
 * server-visible signal at all. A row here saying `201` means Apple accepted the message, and
 * nothing more than that. Recorded honestly rather than presented as delivery.
 *
 * The notification's **title** is kept and its body is not. The title is the app's own words
 * about a card; a body carries a price, which is eBay content and inherits the spec's 90-day
 * expiry on listing data. Keeping the title makes the log legible without giving a retention
 * policy something new to reason about.
 */
export const pushEchoLog = sqliteTable(
	"push_echo_log",
	{
		id: text("id").primaryKey(),
		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => pushSubscriptions.id),
		/** UTC epoch ms at the moment the request went out. */
		sentAt: integer("sent_at").notNull(),
		/** What prompted it: `test` here; `instant`, `digest` and `gap-recovery` in later tickets. */
		kind: text("kind").notNull(),
		/** Which of the two shapes was sent. Never both, to any one subscription. */
		transport: text("transport", { enum: PUSH_TRANSPORTS }).notNull(),
		title: text("title").notNull(),
		/** Plaintext size in bytes, against the ~3.5 KB budget. Not the encrypted length. */
		payloadBytes: integer("payload_bytes").notNull(),
		/** Must be positive, or Apple answers `BadTtl`. */
		ttlSeconds: integer("ttl_seconds").notNull(),
		/** Null when the request never got an answer — a timeout or a dead network. */
		statusCode: integer("status_code"),
		/** Trimmed. Apple's error bodies are short and name the fault (`VapidPkHashMismatch`). */
		responseBody: text("response_body"),
		/** The transport-level failure, when there was no response at all. */
		error: text("error"),
		durationMs: integer("duration_ms").notNull(),
	},
	(table) => [index("push_echo_log_sent_at_idx").on(table.sentAt)],
);

export type PushEchoLogRow = typeof pushEchoLog.$inferSelect;

/**
 * Phase 1 of the corpus sync, stored rather than discarded.
 *
 * The brief list is the whole of `/v2/{lang}/cards` for every language TCGdex serves —
 * 138,909 records, ~13 MB of JSON, the overwhelming majority of them nothing to do with the
 * Oddish line. Keeping it is what makes "filtering done locally" true across syncs rather than
 * only within one: re-scoping the masterset re-runs `selectMembers` over this table and fetches
 * detail for whatever is newly included, instead of re-crawling every language.
 *
 * `dex_ids` is a JSON array, populated from the per-species dex index because the brief form
 * itself does not carry the field.
 */
export const corpusBrief = sqliteTable(
	"corpus_brief",
	{
		language: text("language").notNull(),
		cardId: text("card_id").notNull(),
		localId: text("local_id").notNull(),
		name: text("name").notNull(),
		/** JSON array of numbers; `[]` when the card matched the name sweep alone. */
		dexIds: text("dex_ids").notNull().default("[]"),
		/** Upstream's image base URL, or null where upstream has no image for the card. */
		imageBase: text("image_base"),
		/** UTC epoch ms of the sync that last saw this record. */
		syncedAt: integer("synced_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.language, table.cardId] }),
		index("corpus_brief_name_idx").on(table.name),
	],
);

export type CorpusBriefRow = typeof corpusBrief.$inferSelect;

/**
 * One language-specific printed card record. English `sv03-002` and Japanese `SV3-002` are two
 * cards, not two translations of one.
 *
 * **Language is part of identity.** `card_key` is `{language}:{card_id}`, and the unique index
 * on `(language, set_id, local_id)` is the spec's stated identity held as a constraint rather
 * than as a convention. A key of `{set}-{local}` alone would silently overwrite five western
 * languages on the sixth ingest pass.
 *
 * Hand-added rows take `manual:{uuid}` — a namespace upstream can never mint, because `manual`
 * is not a TCGdex language code and the sync asserts it never becomes one.
 *
 * Images attach here, to the card, not to the variant: one webp BLOB per card record.
 */
export const corpusCards = sqliteTable(
	"corpus_cards",
	{
		/** `{language}:{card_id}`, or `manual:{uuid}`. Path-encoded wherever it appears in a URL. */
		cardKey: text("card_key").primaryKey(),
		language: text("language").notNull(),
		cardId: text("card_id").notNull(),
		setId: text("set_id").notNull(),
		setName: text("set_name"),
		localId: text("local_id").notNull(),
		name: text("name").notNull(),
		category: text("category"),
		rarity: text("rarity"),
		/** JSON array of numbers, as upstream reports them. */
		dexIds: text("dex_ids").notNull().default("[]"),
		/** `dex` | `name` | `both` — which half of the union admitted this card. */
		membershipReason: text("membership_reason").notNull(),

		/** Upstream's image base URL, verbatim: its casing is authoritative and ours is not. */
		imageBase: text("image_base"),
		/** The series segment of that URL, which is the key `datas.json` nests sets under. */
		imageSeries: text("image_series"),
		/** The `datas.json` hash. Incremental sync re-fetches only when this changes. */
		imageHash: text("image_hash"),
		imageBytes: blob("image_bytes", { mode: "buffer" }),
		imageByteSize: integer("image_byte_size"),
		imageContentType: text("image_content_type"),
		imageFetchedAt: integer("image_fetched_at"),

		/** `tcgdex` | `manual`. A sync never touches a `manual` row. */
		provenance: text("provenance").notNull(),
		/** 0/1. Flagged, never deleted — an upstream correction must not take ownership with it. */
		missingUpstream: integer("missing_upstream").notNull().default(0),
		missingSince: integer("missing_since"),
		firstSeenAt: integer("first_seen_at").notNull(),
		lastSyncedAt: integer("last_synced_at").notNull(),
	},
	(table) => [
		uniqueIndex("corpus_cards_identity_idx").on(table.language, table.setId, table.localId),
		index("corpus_cards_language_idx").on(table.language),
		index("corpus_cards_name_idx").on(table.name),
	],
);

export type CorpusCardRow = typeof corpusCards.$inferSelect;

/**
 * The unit of collecting: one print variant, in one language.
 *
 * **Identity is `(card_key, variant_id)` — the composite primary key, so keying on `variant_id`
 * alone is not merely discouraged but unrepresentable.** In the live Oddish line 818 variants
 * carry only 21 distinct `variant_id`s; the most-shared is held by 264 different cards, and the
 * literal string `"generated"` is held by 106. Keyed on `variant_id` the masterset collapses
 * from 818 rows to 21.
 *
 * `variant_id` is an opaque token and is never parsed.
 *
 * The five axes are stored canonicalised, because TCGdex returns them as display strings in the
 * card's own language (`Olografica`, `Padrão`, `1re Édition`) and the binder filters across
 * languages. `upstream_raw` keeps the untouched upstream object so a canonicalisation defect is
 * repairable from the database rather than by re-crawling.
 */
export const corpusVariants = sqliteTable(
	"corpus_variants",
	{
		cardKey: text("card_key")
			.notNull()
			.references(() => corpusCards.cardKey),
		/** Opaque. Never parsed, never split, never assumed hash-shaped. */
		variantId: text("variant_id").notNull(),

		/** Upstream `type`: normal | holo | reverse. */
		finish: text("finish"),
		subtype: text("subtype"),
		/** JSON array, canonicalised, de-duplicated and **sorted**, so order cannot matter. */
		stamps: text("stamps").notNull().default("[]"),
		foil: text("foil"),
		size: text("size"),
		/** The upstream `variants_detailed` entry as received, minus pricing. JSON. */
		upstreamRaw: text("upstream_raw"),

		provenance: text("provenance").notNull(),
		missingUpstream: integer("missing_upstream").notNull().default(0),
		missingSince: integer("missing_since"),
		firstSeenAt: integer("first_seen_at").notNull(),
		lastSyncedAt: integer("last_synced_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.cardKey, table.variantId] }),
		index("corpus_variants_card_idx").on(table.cardKey),
		index("corpus_variants_missing_idx").on(table.missingUpstream),
	],
);

export type CorpusVariantRow = typeof corpusVariants.$inferSelect;

/**
 * Cards the owner has ruled out of the masterset by hand — a name-sweep false positive, a
 * non-TCG item that slipped through. Applied in phase 1, before any detail is fetched.
 *
 * **A sync never writes to this table.** It survives a re-import untouched, exactly as
 * hand-added rows do.
 */
export const corpusExclusions = sqliteTable("corpus_exclusions", {
	cardKey: text("card_key").primaryKey(),
	reason: text("reason"),
	createdAt: integer("created_at").notNull(),
});

export type CorpusExclusionRow = typeof corpusExclusions.$inferSelect;

/**
 * A corpus sync, as a job rather than a request.
 *
 * Pressing sync writes a row here and returns its id; the work runs on after the response. The
 * row is the observable progress *and* the completion marker that survives a restart — a job
 * still `running` when the server boots is reconciled to `failed`, so a reboot mid-sync leaves
 * an honest record rather than a job that appears to be running forever.
 *
 * `variant_count_before` / `variant_count_after` exist because completion has no oracle: a
 * membership regression that silently drops rows shrinks the denominator and makes the
 * percentage go *up* with every test still green. Recording the count each sync turns that into
 * something the app can warn about.
 */
export const corpusSyncJobs = sqliteTable(
	"corpus_sync_jobs",
	{
		/** UUID, minted server-side when the job is created. */
		id: text("id").primaryKey(),
		/** `running` | `succeeded` | `failed` | `interrupted`. */
		status: text("status").notNull(),
		/** `languages` | `brief` | `detail` | `images` | `reconcile` | `done`. */
		phase: text("phase").notNull(),
		startedAt: integer("started_at").notNull(),
		/** Advanced on every progress write; how a stalled job is told from a live one. */
		updatedAt: integer("updated_at").notNull(),
		finishedAt: integer("finished_at"),
		processed: integer("processed").notNull().default(0),
		/** Null until the phase knows its own size. */
		total: integer("total"),
		message: text("message"),
		error: text("error"),

		/** JSON array of the languages this sync actually completed. */
		languagesSynced: text("languages_synced").notNull().default("[]"),
		cardsUpserted: integer("cards_upserted").notNull().default(0),
		variantsUpserted: integer("variants_upserted").notNull().default(0),
		cardsFlaggedMissing: integer("cards_flagged_missing").notNull().default(0),
		variantsFlaggedMissing: integer("variants_flagged_missing").notNull().default(0),
		imagesFetched: integer("images_fetched").notNull().default(0),
		imagesUnchanged: integer("images_unchanged").notNull().default(0),
		imageBytesFetched: integer("image_bytes_fetched").notNull().default(0),
		/** JSON: axis values that canonicalised to something outside the known vocabulary. */
		unknownAxisValues: text("unknown_axis_values").notNull().default("[]"),
		variantCountBefore: integer("variant_count_before"),
		variantCountAfter: integer("variant_count_after"),
	},
	(table) => [index("corpus_sync_jobs_started_idx").on(table.startedAt)],
);

export type CorpusSyncJobRow = typeof corpusSyncJobs.$inferSelect;
