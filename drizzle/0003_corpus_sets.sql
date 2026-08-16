CREATE TABLE `corpus_sets` (
	`set_key` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`set_id` text NOT NULL,
	`name` text,
	`release_date` text,
	`serie_id` text,
	`serie_name` text,
	`abbreviation` text,
	`card_count_total` integer,
	`provenance` text NOT NULL,
	`missing_upstream` integer DEFAULT 0 NOT NULL,
	`missing_since` integer,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `corpus_sync_jobs` ADD `sets_fetched` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `corpus_sync_jobs` ADD `sets_unchanged` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `corpus_sync_jobs` ADD `sets_flagged_missing` integer DEFAULT 0 NOT NULL;