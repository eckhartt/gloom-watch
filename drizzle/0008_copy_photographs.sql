CREATE TABLE `copy_photographs` (
	`id` text PRIMARY KEY NOT NULL,
	`copy_id` text NOT NULL,
	`image_bytes` blob NOT NULL,
	`image_byte_size` integer NOT NULL,
	`image_content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `copy_photographs_copy_idx` ON `copy_photographs` (`copy_id`);