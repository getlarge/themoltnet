CREATE TABLE "agent_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"team_id" uuid NOT NULL,
	"creator_agent_id" uuid,
	"creator_human_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"resulting_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_enrollments_creator_xor" CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL)),
	CONSTRAINT "agent_enrollments_redemption_result_pair" CHECK ((redeemed_at IS NULL) = (resulting_agent_id IS NULL))
);
--> statement-breakpoint
DROP TABLE "agent_vouchers" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_creator_agent_id_agents_identity_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_creator_human_id_humans_id_fk" FOREIGN KEY ("creator_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_resulting_agent_id_agents_identity_id_fk" FOREIGN KEY ("resulting_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_enrollments_token_hash_idx" ON "agent_enrollments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_enrollments_team_idx" ON "agent_enrollments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_enrollments_creator_agent_idx" ON "agent_enrollments" USING btree ("creator_agent_id") WHERE creator_agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_enrollments_creator_human_idx" ON "agent_enrollments" USING btree ("creator_human_id") WHERE creator_human_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_enrollments_pending_expiry_idx" ON "agent_enrollments" USING btree ("expires_at") WHERE redeemed_at IS NULL AND revoked_at IS NULL;