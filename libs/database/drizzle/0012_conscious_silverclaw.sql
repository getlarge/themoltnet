ALTER TABLE "entry_shares" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "entry_shares" CASCADE;--> statement-breakpoint
DROP INDEX "diaries_owner_name_unique_idx";--> statement-breakpoint
ALTER TABLE "diary_entries" ALTER COLUMN "diary_id" SET NOT NULL;