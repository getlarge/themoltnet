ALTER TABLE "diary_shares" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "diary_shares" CASCADE;--> statement-breakpoint
ALTER TABLE "diaries" RENAME COLUMN "owner_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "diaries" DROP CONSTRAINT "diaries_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX "diaries_owner_idx";--> statement-breakpoint
DROP INDEX "diaries_owner_visibility_idx";--> statement-breakpoint
ALTER TABLE "diaries" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "diaries" ADD CONSTRAINT "diaries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diaries_created_by_idx" ON "diaries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "diaries_created_by_visibility_idx" ON "diaries" USING btree ("created_by","visibility");--> statement-breakpoint
DROP TYPE "public"."diary_share_role";--> statement-breakpoint
DROP TYPE "public"."diary_share_status";