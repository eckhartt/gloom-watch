CREATE TABLE `corpus_brief` (
	`language` text NOT NULL,
	`card_id` text NOT NULL,
	`local_id` text NOT NULL,
	`name` text NOT NULL,
	`dex_ids` text DEFAULT '[]' NOT NULL,
	`image_base` text,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`language`, `card_id`)
);
--> statement-breakpoint
CREATE INDEX `corpus_brief_name_idx` ON `corpus_brief` (`name`);--> statement-breakpoint
CREATE TABLE `corpus_cards` (
	`card_key` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`card_id` text NOT NULL,
	`set_id` text NOT NULL,
	`set_name` text,
	`local_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`rarity` text,
	`dex_ids` text DEFAULT '[]' NOT NULL,
	`membership_reason` text NOT NULL,
	`image_base` text,
	`image_series` text,
	`image_hash` text,
	`image_bytes` blob,
	`image_byte_size` integer,
	`image_content_type` text,
	`image_fetched_at` integer,
	`provenance` text NOT NULL,
	`missing_upstream` integer DEFAULT 0 NOT NULL,
	`missing_since` integer,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_cards_identity_idx` ON `corpus_cards` (`language`,`set_id`,`local_id`);--> statement-breakpoint
CREATE INDEX `corpus_cards_language_idx` ON `corpus_cards` (`language`);--> statement-breakpoint
CREATE INDEX `corpus_cards_name_idx` ON `corpus_cards` (`name`);--> statement-breakpoint
CREATE TABLE `corpus_exclusions` (
	`card_key` text PRIMARY KEY NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `corpus_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	`processed` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`message` text,
	`error` text,
	`languages_synced` text DEFAULT '[]' NOT NULL,
	`cards_upserted` integer DEFAULT 0 NOT NULL,
	`variants_upserted` integer DEFAULT 0 NOT NULL,
	`cards_flagged_missing` integer DEFAULT 0 NOT NULL,
	`variants_flagged_missing` integer DEFAULT 0 NOT NULL,
	`images_fetched` integer DEFAULT 0 NOT NULL,
	`images_unchanged` integer DEFAULT 0 NOT NULL,
	`image_bytes_fetched` integer DEFAULT 0 NOT NULL,
	`unknown_axis_values` text DEFAULT '[]' NOT NULL,
	`variant_count_before` integer,
	`variant_count_after` integer
);
--> statement-breakpoint
CREATE INDEX `corpus_sync_jobs_started_idx` ON `corpus_sync_jobs` (`started_at`);--> statement-breakpoint
CREATE TABLE `corpus_variants` (
	`card_key` text NOT NULL,
	`variant_id` text NOT NULL,
	`finish` text,
	`subtype` text,
	`stamps` text DEFAULT '[]' NOT NULL,
	`foil` text,
	`size` text,
	`upstream_raw` text,
	`provenance` text NOT NULL,
	`missing_upstream` integer DEFAULT 0 NOT NULL,
	`missing_since` integer,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	PRIMARY KEY(`card_key`, `variant_id`),
	FOREIGN KEY (`card_key`) REFERENCES `corpus_cards`(`card_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `corpus_variants_card_idx` ON `corpus_variants` (`card_key`);--> statement-breakpoint
CREATE INDEX `corpus_variants_missing_idx` ON `corpus_variants` (`missing_upstream`);