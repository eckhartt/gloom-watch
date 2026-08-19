CREATE TABLE `aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`phrase` text NOT NULL,
	`card_key` text NOT NULL,
	`variant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_key`) REFERENCES `corpus_cards`(`card_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_phrase_idx` ON `aliases` (`phrase`);--> statement-breakpoint
CREATE INDEX `aliases_card_idx` ON `aliases` (`card_key`);--> statement-breakpoint
CREATE TABLE `listing_queue_states` (
	`item_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`phrase` text,
	`resolved_card_key` text,
	`resolved_variant_id` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "listing_queue_states_known" CHECK("listing_queue_states"."state" in ('unattempted', 'auto_matched', 'queued', 'resolved', 'not_a_match'))
);
--> statement-breakpoint
CREATE INDEX `listing_queue_states_state_idx` ON `listing_queue_states` (`state`);