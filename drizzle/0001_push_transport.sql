CREATE TABLE `push_echo_log` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`kind` text NOT NULL,
	`transport` text NOT NULL,
	`title` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`status_code` integer,
	`response_body` text,
	`error` text,
	`duration_ms` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `push_echo_log_sent_at_idx` ON `push_echo_log` (`sent_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`transport` text NOT NULL,
	`expiration_time` integer,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_success_at` integer,
	`retired_at` integer,
	`retired_status` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);