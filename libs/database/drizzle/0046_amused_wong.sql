CREATE TABLE "team_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"idempotency_hash" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"invite_role" "team_invite_role" NOT NULL,
	"role" text,
	"membership_granted_at" timestamp with time zone,
	"issued_key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_enrollments_membership_pair" CHECK (("team_enrollments"."role" IS NULL) = ("team_enrollments"."membership_granted_at" IS NULL)),
	CONSTRAINT "team_enrollments_issuance_order" CHECK ("team_enrollments"."issued_key_id" IS NULL OR "team_enrollments"."membership_granted_at" IS NOT NULL),
	CONSTRAINT "team_enrollments_role" CHECK ("team_enrollments"."role" IS NULL OR "team_enrollments"."role" IN ('owner', 'manager', 'executor', 'member'))
);
--> statement-breakpoint
ALTER TABLE "team_enrollments" ADD CONSTRAINT "team_enrollments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_enrollments" ADD CONSTRAINT "team_enrollments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_enrollments_agent_request_idx" ON "team_enrollments" USING btree ("agent_id","idempotency_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "team_enrollments_invite_agent_idx" ON "team_enrollments" USING btree ("invite_id","agent_id");