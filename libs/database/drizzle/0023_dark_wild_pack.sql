CREATE TYPE "public"."runtime_slot_state" AS ENUM('active', 'idle');--> statement-breakpoint
CREATE TYPE "public"."runtime_workspace_kind" AS ENUM('origin', 'fork', 'scratch');--> statement-breakpoint
CREATE TABLE "runtime_slot_sessions" (
	"slot_id" uuid PRIMARY KEY NOT NULL,
	"session_dir" text NOT NULL,
	"session_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"daemon_id" varchar(200) NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"daemon_profile_id" uuid,
	"provider" varchar(100) NOT NULL,
	"model" varchar(200) NOT NULL,
	"slot_key" text NOT NULL,
	"task_type" varchar(100) NOT NULL,
	"state" "runtime_slot_state" NOT NULL,
	"last_task_id" uuid NOT NULL,
	"last_attempt_n" integer NOT NULL,
	"workspace_row_id" uuid,
	"created_at_ms" bigint NOT NULL,
	"last_used_at_ms" bigint NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"worktree_path" text NOT NULL,
	"worktree_branch" text,
	"kind" "runtime_workspace_kind" NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"last_used_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_slot_sessions" ADD CONSTRAINT "runtime_slot_sessions_slot_id_runtime_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."runtime_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_slots" ADD CONSTRAINT "runtime_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_slots" ADD CONSTRAINT "runtime_slots_daemon_profile_id_daemon_profiles_id_fk" FOREIGN KEY ("daemon_profile_id") REFERENCES "public"."daemon_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_slots" ADD CONSTRAINT "runtime_slots_last_task_id_tasks_id_fk" FOREIGN KEY ("last_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_slots" ADD CONSTRAINT "runtime_slots_workspace_row_id_runtime_workspaces_id_fk" FOREIGN KEY ("workspace_row_id") REFERENCES "public"."runtime_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_slots" ADD CONSTRAINT "runtime_slots_last_task_id_last_attempt_n_task_attempts_task_id_attempt_n_fk" FOREIGN KEY ("last_task_id","last_attempt_n") REFERENCES "public"."task_attempts"("task_id","attempt_n") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_workspaces" ADD CONSTRAINT "runtime_workspaces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_slot_sessions_session_path_idx" ON "runtime_slot_sessions" USING btree ("session_path") WHERE session_path IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_slots_identity_idx" ON "runtime_slots" USING btree ("team_id","daemon_id","agent_name","provider","model","slot_key");--> statement-breakpoint
CREATE INDEX "runtime_slots_team_idx" ON "runtime_slots" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "runtime_slots_profile_idx" ON "runtime_slots" USING btree ("daemon_profile_id") WHERE daemon_profile_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runtime_slots_task_attempt_idx" ON "runtime_slots" USING btree ("team_id","last_task_id","last_attempt_n","last_used_at_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_workspaces_team_workspace_idx" ON "runtime_workspaces" USING btree ("team_id","workspace_id");--> statement-breakpoint
CREATE INDEX "runtime_workspaces_team_idx" ON "runtime_workspaces" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "runtime_workspaces_branch_idx" ON "runtime_workspaces" USING btree ("team_id","worktree_branch") WHERE worktree_branch IS NOT NULL;
