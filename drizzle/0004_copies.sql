CREATE TABLE `copies` (
	`id` text PRIMARY KEY NOT NULL,
	`card_key` text NOT NULL,
	`variant_id` text NOT NULL,
	`condition` text,
	`grader` text,
	`grade` integer,
	`cert_no` text,
	`price_minor` integer,
	`currency` text,
	`price_home_minor` integer,
	`home_currency` text,
	`rate_date` text,
	`acquired_at` text,
	`source_type` text,
	`source_note` text,
	`note` text,
	`status` text NOT NULL,
	`disposed_at` text,
	`disposal_kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_key`,`variant_id`) REFERENCES `corpus_variants`(`card_key`,`variant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "copies_status_known" CHECK("copies"."status" in ('owned', 'disposed')),
	CONSTRAINT "copies_grade_needs_grader" CHECK("copies"."grade" is null or "copies"."grader" is not null),
	CONSTRAINT "copies_price_needs_currency" CHECK("copies"."price_minor" is null or "copies"."currency" is not null),
	CONSTRAINT "copies_home_price_needs_currency_and_rate_date" CHECK("copies"."price_home_minor" is null or ("copies"."home_currency" is not null and "copies"."rate_date" is not null)),
	CONSTRAINT "copies_disposed_needs_date" CHECK("copies"."status" <> 'disposed' or "copies"."disposed_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `copies_owned_idx` ON `copies` (`status`,`card_key`,`variant_id`);--> statement-breakpoint
CREATE INDEX `copies_variant_idx` ON `copies` (`card_key`,`variant_id`);--> statement-breakpoint
CREATE TABLE `variant_priorities` (
	`card_key` text NOT NULL,
	`variant_id` text NOT NULL,
	`priority` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`card_key`, `variant_id`),
	FOREIGN KEY (`card_key`,`variant_id`) REFERENCES `corpus_variants`(`card_key`,`variant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "variant_priorities_range" CHECK("variant_priorities"."priority" between 0 and 3)
);
