import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { PUSH_TRANSPORTS } from "../../shared/push.ts";

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
