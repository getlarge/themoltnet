CREATE TYPE "public"."daemon_profile_runtime_kind" AS ENUM('gondolin_pi');--> statement-breakpoint
CREATE TYPE "public"."daemon_profile_storage_mode" AS ENUM('local');--> statement-breakpoint
CREATE TABLE "daemon_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"provider" varchar(100) NOT NULL,
	"model" varchar(200) NOT NULL,
	"runtime_kind" "daemon_profile_runtime_kind" DEFAULT 'gondolin_pi' NOT NULL,
	"sandbox" jsonb NOT NULL,
	"session_storage_mode" "daemon_profile_storage_mode" DEFAULT 'local' NOT NULL,
	"workspace_storage_mode" "daemon_profile_storage_mode" DEFAULT 'local' NOT NULL,
	"session_ttl_sec" integer DEFAULT 1800 NOT NULL,
	"workspace_ttl_sec" integer DEFAULT 1800 NOT NULL,
	"required_env" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"definition_cid" varchar(100) NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_human_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daemon_profiles_creator_xor" CHECK ((created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL)),
	CONSTRAINT "daemon_profiles_session_ttl_positive" CHECK (session_ttl_sec > 0),
	CONSTRAINT "daemon_profiles_workspace_ttl_positive" CHECK (workspace_ttl_sec > 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "allowed_profiles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_allowed_executors_gin_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "allowed_executors";--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_created_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_profiles" ADD CONSTRAINT "daemon_profiles_created_by_human_id_humans_id_fk" FOREIGN KEY ("created_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_profiles_team_name_idx" ON "daemon_profiles" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "daemon_profiles_team_idx" ON "daemon_profiles" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "tasks_allowed_profiles_gin_idx" ON "tasks" USING gin ("allowed_profiles" jsonb_path_ops);
