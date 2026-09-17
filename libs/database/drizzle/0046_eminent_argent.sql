ALTER TABLE "team_invites" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "enrollment_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "idempotency_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_enrollment_agent_id_agents_id_fk" FOREIGN KEY ("enrollment_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_agent_request_idx" ON "team_invites" USING btree ("enrollment_agent_id","idempotency_hash");--> statement-breakpoint
-- Preserve consumed invitations when replacing counters with single-use state.
UPDATE "team_invites" SET "used_at" = "created_at" WHERE "use_count" > 0;--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "max_uses";--> statement-breakpoint
ALTER TABLE "team_invites" DROP COLUMN "use_count";--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_enrollment_claim" CHECK (("team_invites"."enrollment_agent_id" IS NULL AND "team_invites"."idempotency_hash" IS NULL AND "team_invites"."request_hash" IS NULL) OR ("team_invites"."enrollment_agent_id" IS NOT NULL AND "team_invites"."idempotency_hash" IS NOT NULL AND "team_invites"."request_hash" IS NOT NULL AND "team_invites"."used_at" IS NOT NULL));