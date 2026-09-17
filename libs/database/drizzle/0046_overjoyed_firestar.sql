ALTER TABLE "team_invites" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
-- Preserve previously consumed invites before removing their counters.
UPDATE "team_invites" SET "used_at" = "created_at" WHERE "use_count" > 0;--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "max_uses";--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "use_count";