CREATE TABLE `listings` (
	`item_id` text PRIMARY KEY NOT NULL,
	`marketplace` text NOT NULL,
	`title` text NOT NULL,
	`price_minor` integer,
	`currency` text,
	`buying_option` text,
	`condition_id` integer,
	`item_web_url` text,
	`item_location_country` text,
	`item_origin_date` integer,
	`observed_at` integer NOT NULL,
	`seller_hash` text,
	`aspects` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "listings_price_needs_currency" CHECK("listings"."price_minor" is null or "listings"."currency" is not null)
);
--> statement-breakpoint
CREATE INDEX `listings_observed_at_idx` ON `listings` (`observed_at`);--> statement-breakpoint
CREATE INDEX `listings_marketplace_idx` ON `listings` (`marketplace`);--> statement-breakpoint
CREATE TABLE `scan_budget` (
	`day` text PRIMARY KEY NOT NULL,
	`calls_used` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_cursors` (
	`marketplace` text PRIMARY KEY NOT NULL,
	`last_scanned_at` integer,
	`last_success_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`category_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seen_items` (
	`item_id` text PRIMARY KEY NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
