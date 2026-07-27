CREATE TABLE "runtime_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_human_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_policies_creator_xor" CHECK ((created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)),
	CONSTRAINT "runtime_policies_description_length" CHECK (description IS NULL OR length(description) <= 4096)
);
--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "tool_enforcement" varchar(16) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_policies" ADD CONSTRAINT "runtime_policies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_policies" ADD CONSTRAINT "runtime_policies_created_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_policies" ADD CONSTRAINT "runtime_policies_created_by_human_id_humans_id_fk" FOREIGN KEY ("created_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_policies_team_name_idx" ON "runtime_policies" USING btree ("team_id","name");--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_tool_enforcement_valid" CHECK (tool_enforcement = ANY(ARRAY['off','watch','enforce']::text[]));