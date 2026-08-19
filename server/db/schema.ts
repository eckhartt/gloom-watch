import { sql } from "drizzle-orm";
import {
	blob,
	check,
	foreignKey,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	COPY_CONDITIONS,
	COPY_DISPOSAL_KINDS,
	COPY_GRADERS,
	COPY_SOURCE_TYPES,
	COPY_STATUSES,
} from "../../shared/copies.ts";
import { MARKETPLACES } from "../../shared/listings.ts";
import { PUSH_TRANSPORTS } from "../../shared/push.ts";

/**
 * `app_state` is a key/value store of server-owned scalars — the commissioning timezone, when
 * the database was first opened, when the cron job last ran, the ETag of the image manifest.
 * It is deliberately *not* named `settings`: the spec's settings surface is a set of tunables
 * the owner edits, and folding a job heartbeat into that table would confuse configuration with
 * health the moment either grows.
 *
 * Photographs and aliases are later tickets and are not modelled here. Listings live in
 * their own tables further down — a field whitelist, never a raw payload.
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
 * One set, in one language — and the only place a **set release date** is stored.
 *
 * The binder's default order is set release date descending, and nothing else in the corpus
 * carries the date. `GET /v2/{lang}/cards/{id}` returns `set: {id, name, cardCount, logo,
 * symbol}` with no date; `GET /v2/{lang}/sets` omits it from every entry; `GET /v2/{lang}/series
 * /{id}` dates the *series* and lists its sets undated. Only `GET /v2/{lang}/sets/{setId}`
 * carries it, one set at a time, which is why this is a table filled by its own sync phase
 * rather than something the binder route could look up per request.
 *
 * **Language is part of identity, exactly as it is on the card.** `set_key` is
 * `{language}:{set_id}`. The Japanese `SV3` released on 2023-07-28 and the English `sv03` on
 * 2023-11-03; one row per set ID would pick one of those and be wrong about the other.
 *
 * `release_date` is an **ISO `YYYY-MM-DD` string, not an epoch**. It is a calendar date rather
 * than an instant — a set released "on 16 June 1999" was not released at a moment in UTC — and
 * the spec's time convention keeps the two apart. ISO dates also sort lexically, which is what
 * the binder's ordering leans on.
 *
 * Null is tolerated and must be: upstream carries a date for every set this corpus references
 * today, promos included (`miscp` → `1996-01-01`), but nothing guarantees the next one will.
 *
 * No index beyond the primary key. The corpus references 137 distinct `(language, set_id)`
 * pairs; a scan of 137 rows is faster than the branch that would decide to use an index.
 */
export const corpusSets = sqliteTable("corpus_sets", {
	/** `{language}:{set_id}`. Path-encoded wherever it appears in a URL, like `card_key`. */
	setKey: text("set_key").primaryKey(),
	language: text("language").notNull(),
	setId: text("set_id").notNull(),
	name: text("name"),
	/** ISO `YYYY-MM-DD`, or null where upstream has no date. **Never an epoch.** */
	releaseDate: text("release_date"),
	serieId: text("serie_id"),
	serieName: text("serie_name"),
	/** `abbreviation.official` — upstream sends an object, and often sends none at all. */
	abbreviation: text("abbreviation"),
	/** `cardCount.total`: how many cards upstream says the set holds, all species. */
	cardCountTotal: integer("card_count_total"),

	/** `tcgdex` | `manual`. A sync never touches a `manual` row, as with cards and variants. */
	provenance: text("provenance").notNull(),
	/** 0/1. A set that 404s is flagged and kept — a card still points at it. */
	missingUpstream: integer("missing_upstream").notNull().default(0),
	missingSince: integer("missing_since"),
	firstSeenAt: integer("first_seen_at").notNull(),
	lastSyncedAt: integer("last_synced_at").notNull(),
});

export type CorpusSetRow = typeof corpusSets.$inferSelect;

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
		/** `languages` | `brief` | `detail` | `sets` | `images` | `reconcile` | `done`. */
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
		/** Sets whose detail was fetched this run — 137 on a first sync, normally 0 after. */
		setsFetched: integer("sets_fetched").notNull().default(0),
		/** Sets already held with a release date, so not asked about again. */
		setsUnchanged: integer("sets_unchanged").notNull().default(0),
		setsFlaggedMissing: integer("sets_flagged_missing").notNull().default(0),
		/** JSON: axis values that canonicalised to something outside the known vocabulary. */
		unknownAxisValues: text("unknown_axis_values").notNull().default("[]"),
		variantCountBefore: integer("variant_count_before"),
		variantCountAfter: integer("variant_count_after"),
	},
	(table) => [index("corpus_sync_jobs_started_idx").on(table.startedAt)],
);

export type CorpusSyncJobRow = typeof corpusSyncJobs.$inferSelect;

/**
 * One physical card the owner holds — or held, and disposed of.
 *
 * **One row is one object, never a quantity.** A PSA 9 and a raw copy of the same variant are two
 * rows, because the cert number, the condition, the price paid and the source all describe one
 * card and a count of two would have nowhere to put the second of each.
 *
 * **`id` is minted by the client.** That is what makes the outbox's replay idempotent in the next
 * ticket but one: a create whose response was lost on a dropping tailnet replays into this same
 * row rather than into a second card that does not exist. A server-generated key could not,
 * because the client would have nothing to replay with.
 *
 * **The identity of the variant is composite**, and it is a real foreign key onto
 * `corpus_variants(card_key, variant_id)` rather than a pair of loose columns. `variant_id` alone
 * is shared by 264 different cards in the live corpus, so a copy keyed on it would be a copy of
 * up to 264 cards at once. `PRAGMA foreign_keys = ON` is set in `db/client.ts`, so this is
 * enforced by SQLite and not merely intended. It never bites on a sync: a variant that vanishes
 * upstream is flagged and kept, never deleted, so a copy pointing at it stays valid.
 *
 * **Disposal retains the row** — `status` moves to `disposed` and `disposed_at` records when.
 * There is no delete path anywhere in the application. Which is precisely why **every ownership
 * query must filter `status = 'owned'`**: the rows are still here, and a query that forgets says
 * the owner holds a card they sold, silently and plausibly.
 *
 * Money is `*_minor` INTEGER paired with an ISO 4217 code, never a float. Grade is integer tenths
 * and requires a grader. The calendar dates are ISO `YYYY-MM-DD` strings, not epochs; `created_at`
 * and `updated_at` are instants and are epoch milliseconds.
 *
 * **There is no defect column and there is not going to be one.** A miscut or an off-centre cut
 * happened to one object rather than to a print run: no enum, no boolean, nothing to sort on. It
 * may be prose in `note`.
 */
export const copies = sqliteTable(
	"copies",
	{
		/** A client-generated UUID. The primary key, so a replayed create yields one row. */
		id: text("id").primaryKey(),
		cardKey: text("card_key").notNull(),
		/** Opaque, and meaningless without `card_key`. The pair is the variant. */
		variantId: text("variant_id").notNull(),

		/** The hobby ladder. **Not eBay's vocabulary**; no mapping exists between them. */
		condition: text("condition", { enum: COPY_CONDITIONS }),
		grader: text("grader", { enum: COPY_GRADERS }),
		/** Integer tenths: `PSA 8.5` is `85`, so half grades compare exactly. Requires `grader`. */
		grade: integer("grade"),
		/** Identifies one physical slab, so the owner can recognise their own card on the market. */
		certNo: text("cert_no"),

		/** Integer minor units of `currency`. ¥4,200 is `4200`, not `420000`. */
		priceMinor: integer("price_minor"),
		currency: text("currency"),
		/** The home-currency value **captured at purchase** — the historical rate is not recoverable. */
		priceHomeMinor: integer("price_home_minor"),
		homeCurrency: text("home_currency"),
		/** ISO `YYYY-MM-DD`: when the rate was taken. Typed by hand; there is no FX API. */
		rateDate: text("rate_date"),

		/** ISO `YYYY-MM-DD`. A calendar date, not an instant. */
		acquiredAt: text("acquired_at"),
		/** Where the card came from. Distinct from a variant's `provenance`, which is about the row. */
		sourceType: text("source_type", { enum: COPY_SOURCE_TYPES }),
		/** The owner's own words. No eBay seller identity is ever stored, here or anywhere. */
		sourceNote: text("source_note"),
		note: text("note"),

		status: text("status", { enum: COPY_STATUSES }).notNull(),
		/** ISO `YYYY-MM-DD`. Required once the status is `disposed`; see the check below. */
		disposedAt: text("disposed_at"),
		disposalKind: text("disposal_kind", { enum: COPY_DISPOSAL_KINDS }),

		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.cardKey, table.variantId],
			foreignColumns: [corpusVariants.cardKey, corpusVariants.variantId],
			name: "copies_variant_fk",
		}),
		/**
		 * Status first, because the one query that reads ownership filters on it before anything
		 * else and then groups by the pair — so this index is the whole query.
		 */
		index("copies_owned_idx").on(table.status, table.cardKey, table.variantId),
		/** The sheet's purchase trail for one variant, disposed rows included. */
		index("copies_variant_idx").on(table.cardKey, table.variantId),

		/**
		 * The invariants, held by the database as well as by the validator.
		 *
		 * They are here because the validator is one code path and this table will grow others — an
		 * import route and an outbox replay are both stated requirements. A rule enforced only in a
		 * request handler is a rule that holds for requests.
		 *
		 * Only the ones whose violation is *silent* are checked. A bad `condition` shows up as a
		 * strange label on a screen; a `status` of `Owned` drops the card out of the collection with
		 * no visible symptom at all, and a grade with no grader is a number that means nothing.
		 */
		check("copies_status_known", sql`${table.status} in ('owned', 'disposed')`),
		check("copies_grade_needs_grader", sql`${table.grade} is null or ${table.grader} is not null`),
		check(
			"copies_price_needs_currency",
			sql`${table.priceMinor} is null or ${table.currency} is not null`,
		),
		check(
			"copies_home_price_needs_currency_and_rate_date",
			sql`${table.priceHomeMinor} is null or (${table.homeCurrency} is not null and ${table.rateDate} is not null)`,
		),
		check(
			"copies_disposed_needs_date",
			sql`${table.status} <> 'disposed' or ${table.disposedAt} is not null`,
		),
	],
);

export type CopyRow = typeof copies.$inferSelect;

/**
 * The owner's priority on a variant they do not hold — the dial the notification policy reads.
 *
 * **A table of its own rather than a column on `corpus_variants`, and that is the point.** The
 * sync owns every column of that table and upserts them from upstream; a priority sitting among
 * them survives only for as long as nobody adds it to an `excluded.*` list. The spec requires
 * priorities to survive a re-import, and here that is structural: the sync has no reason to write
 * to this table and no statement in `corpus/repository.ts` names it.
 *
 * Keyed on the same composite identity as everything else, with the same foreign key. Absent
 * means unset — clearing a priority deletes the row rather than storing a zero, because `0` is a
 * real rung on the 0–3 scale and would otherwise be indistinguishable from "never set".
 */
export const variantPriorities = sqliteTable(
	"variant_priorities",
	{
		cardKey: text("card_key").notNull(),
		variantId: text("variant_id").notNull(),
		/** 0–3. `priority_instant_level` (default 3) is the rung that pushes instantly. */
		priority: integer("priority").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.cardKey, table.variantId] }),
		foreignKey({
			columns: [table.cardKey, table.variantId],
			foreignColumns: [corpusVariants.cardKey, corpusVariants.variantId],
			name: "variant_priorities_variant_fk",
		}),
		check("variant_priorities_range", sql`${table.priority} between 0 and 3`),
	],
);

export type VariantPriorityRow = typeof variantPriorities.$inferSelect;

/**
 * One eBay item the scanner has observed, stored as a **field whitelist**.
 *
 * The whitelist is applied at the eBay client boundary, before anything reaches this table.
 * A raw Browse `ItemSummary` contains `seller.username`; persisting that would forfeit the
 * account-deletion opt-out and force a public HTTPS endpoint, which would kill tailnet-only
 * hosting. The seller object never reaches disk. The only permitted derivative is
 * `seller_hash` — HMAC-SHA-256 keyed by `RELIST_HASH_SALT` — used solely as a relist dedupe
 * key and never displayed.
 *
 * **The whole row is eBay content**, so the whole row expires at 90 days. There is no separate
 * payload column to purge. The seen-set (an opaque item id and a timestamp) survives in its
 * own table and holds nothing of eBay's.
 *
 * `condition_id` is stored as eBay sent it and is **never mapped to a card condition**. For
 * trading cards it means graded/ungraded, and `4000` reads as "Very Good" while meaning
 * *ungraded*. Nothing in this application translates it.
 */
export const listings = sqliteTable(
	"listings",
	{
		/** eBay's `itemId`, typically `v1|{legacyId}|0`. Unique across marketplaces. */
		itemId: text("item_id").primaryKey(),
		marketplace: text("marketplace", { enum: MARKETPLACES }).notNull(),
		title: text("title").notNull(),
		/** Integer minor units of `currency`. Hidden on the wire after six hours, kept here. */
		priceMinor: integer("price_minor"),
		currency: text("currency"),
		/** `FIXED_PRICE`, `AUCTION`, `BEST_OFFER` — eBay's buying option, not a card condition. */
		buyingOption: text("buying_option"),
		/** Raw eBay `conditionId`. Never mapped. */
		conditionId: integer("condition_id"),
		itemWebUrl: text("item_web_url"),
		itemLocationCountry: text("item_location_country"),
		/** UTC epoch ms of `itemOriginDate`. Survives a relist; a new listing mints a new one. */
		itemOriginDate: integer("item_origin_date"),
		/** UTC epoch ms of this observation. Retention and the six-hour rule both key off it. */
		observedAt: integer("observed_at").notNull(),
		/**
		 * HMAC-SHA-256(RELIST_HASH_SALT, seller.username) as lowercase hex.
		 * Never selected onto the wire. Expires with the row.
		 */
		sellerHash: text("seller_hash"),
		/** JSON object of result-set aspects that arrived with the summary, else `{}`. */
		aspects: text("aspects").notNull().default("{}"),
	},
	(table) => [
		index("listings_observed_at_idx").on(table.observedAt),
		index("listings_marketplace_idx").on(table.marketplace),
		check(
			"listings_price_needs_currency",
			sql`${table.priceMinor} is null or ${table.currency} is not null`,
		),
	],
);

export type ListingRow = typeof listings.$inferSelect;

/**
 * Every item id the scanner has ever seen, and **nothing else**.
 *
 * This is not eBay content — an opaque identifier and two timestamps — so it never expires.
 * It is what stops a listing that fell out of the 90-day window from re-notifying on day 91
 * when the same `itemId` is observed again. The matcher and the push rule read it; the feed
 * does not.
 */
export const seenItems = sqliteTable("seen_items", {
	itemId: text("item_id").primaryKey(),
	firstSeenAt: integer("first_seen_at").notNull(),
	lastSeenAt: integer("last_seen_at").notNull(),
});

export type SeenItemRow = typeof seenItems.$inferSelect;

/**
 * The forward cursor, **one row per marketplace**.
 *
 * GB and DE run every fourth cycle. A single global cursor would advance on an AU/US cycle
 * and the next DE run would miss everything listed in between. `last_scanned_at` is the
 * cursor and advances only on a successful, fully-paged scan for *that* marketplace. A
 * failure increments `consecutive_failures` and leaves it alone.
 *
 * `category_id` is resolved via the Taxonomy API except for US, which is the confirmed leaf
 * `183454`. A marketplace with no category yet is skipped, not guessed at.
 */
export const scanCursors = sqliteTable("scan_cursors", {
	marketplace: text("marketplace", { enum: MARKETPLACES }).primaryKey(),
	/** UTC epoch ms. The next window starts this minus the overlap. Null until the first success. */
	lastScannedAt: integer("last_scanned_at"),
	lastSuccessAt: integer("last_success_at"),
	consecutiveFailures: integer("consecutive_failures").notNull().default(0),
	/** Leaf category ID. US is seeded; the others are written when Taxonomy answers. */
	categoryId: text("category_id"),
	updatedAt: integer("updated_at").notNull(),
});

export type ScanCursorRow = typeof scanCursors.$inferSelect;

/**
 * The commissioning backfill, **one row per marketplace**.
 *
 * This is a separate table on purpose. The forward scanner owns `scan_cursors` and
 * `writeCursorSuccess` / `writeCursorFailure` rewrite that row; folding the completion
 * marker into it would make every scanner insert list these columns and turn a later
 * scanner-schema change into a merge hazard. The gate reads `complete_at` here and
 * nowhere else.
 *
 * `window_end` is the resume cursor: everything after it has been swept. A restart
 * continues from there rather than from `now`. `complete_at` is the marker that
 * arms the forward cursor for that marketplace.
 */
export const backfillCursors = sqliteTable("backfill_cursors", {
	marketplace: text("marketplace", { enum: MARKETPLACES }).primaryKey(),
	/** UTC epoch ms. Null until the sweep has reached `horizon_at`. */
	completeAt: integer("complete_at"),
	startedAt: integer("started_at"),
	/** UTC epoch ms. The oldest `itemStartDate` this sweep will request. */
	horizonAt: integer("horizon_at"),
	/** UTC epoch ms. Next window's end; everything after this has been swept. */
	windowEnd: integer("window_end"),
	itemsUpserted: integer("items_upserted").notNull().default(0),
	callsUsed: integer("calls_used").notNull().default(0),
	lastProgressAt: integer("last_progress_at"),
	updatedAt: integer("updated_at").notNull(),
});

export type BackfillCursorRow = typeof backfillCursors.$inferSelect;

/**
 * Calls spent against the daily Browse/Taxonomy budget, one row per UTC calendar day.
 *
 * Checked before every page. Exhaustion stops the cycle; the next UTC day starts at zero.
 * A 429 still counts — eBay spent the call even though we got nothing.
 */
export const scanBudget = sqliteTable("scan_budget", {
	/** ISO `YYYY-MM-DD` in UTC. A calendar day, not an instant. */
	day: text("day").primaryKey(),
	callsUsed: integer("calls_used").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export type ScanBudgetRow = typeof scanBudget.$inferSelect;
