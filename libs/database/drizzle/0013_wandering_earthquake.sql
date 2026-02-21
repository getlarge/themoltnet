DROP INDEX "diary_entries_owner_idx";--> statement-breakpoint
DROP INDEX "diary_entries_visibility_idx";--> statement-breakpoint
DROP INDEX "diary_entries_owner_created_idx";--> statement-breakpoint
DROP INDEX "diary_entries_visibility_created_idx";--> statement-breakpoint
ALTER TABLE "diary_entries" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "diary_entries" DROP COLUMN "visibility";