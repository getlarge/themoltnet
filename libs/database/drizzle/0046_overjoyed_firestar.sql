ALTER TABLE "team_invites" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
-- Mark every existing invite as consumed at migration time.
-- New invites keep the nullable column default and start unused.
UPDATE "team_invites" SET "used_at" = CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "max_uses";--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "use_count";
