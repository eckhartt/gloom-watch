CREATE TABLE `backfill_cursors` (
	`marketplace` text PRIMARY KEY NOT NULL,
	`complete_at` integer,
	`started_at` integer,
	`horizon_at` integer,
	`window_end` integer,
	`items_upserted` integer DEFAULT 0 NOT NULL,
	`calls_used` integer DEFAULT 0 NOT NULL,
	`last_progress_at` integer,
	`updated_at` integer NOT NULL
);
