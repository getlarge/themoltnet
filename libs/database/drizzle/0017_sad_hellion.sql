ALTER TABLE "diary_entries" ADD COLUMN "content_hash" varchar(100);--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "content_signature" text;