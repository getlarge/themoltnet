CREATE TABLE "daemon_slot_sessions" (
	"agent_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"slot_key" text NOT NULL,
	"session_dir" text NOT NULL,
	"session_path" text,
	CONSTRAINT "daemon_slot_sessions_agent_name_provider_model_slot_key_pk" PRIMARY KEY("agent_name","provider","model","slot_key"),
	CONSTRAINT "daemon_slot_sessions_session_dir_unique" UNIQUE("session_dir")
);
--> statement-breakpoint
CREATE TABLE "daemon_slot_workspaces" (
	"agent_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"slot_key" text NOT NULL,
	"workspace_id" text NOT NULL,
	"worktree_path" text NOT NULL,
	"worktree_branch" text,
	CONSTRAINT "daemon_slot_workspaces_agent_name_provider_model_slot_key_pk" PRIMARY KEY("agent_name","provider","model","slot_key"),
	CONSTRAINT "daemon_slot_workspaces_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "daemon_slots" (
	"agent_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"slot_key" text NOT NULL,
	"task_type" text NOT NULL,
	"state" text NOT NULL,
	"last_task_id" text NOT NULL,
	"last_attempt_n" integer NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"last_used_at_ms" bigint NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	CONSTRAINT "daemon_slots_agent_name_provider_model_slot_key_pk" PRIMARY KEY("agent_name","provider","model","slot_key"),
	CONSTRAINT "daemon_slots_state_check" CHECK ("daemon_slots"."state" IN ('active', 'idle'))
);
--> statement-breakpoint
ALTER TABLE "daemon_slot_sessions" ADD CONSTRAINT "daemon_slot_sessions_agent_name_provider_model_slot_key_daemon_slots_agent_name_provider_model_slot_key_fk" FOREIGN KEY ("agent_name","provider","model","slot_key") REFERENCES "public"."daemon_slots"("agent_name","provider","model","slot_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_slot_workspaces" ADD CONSTRAINT "daemon_slot_workspaces_agent_name_provider_model_slot_key_daemon_slots_agent_name_provider_model_slot_key_fk" FOREIGN KEY ("agent_name","provider","model","slot_key") REFERENCES "public"."daemon_slots"("agent_name","provider","model","slot_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daemon_slots_expires_idx" ON "daemon_slots" USING btree ("expires_at_ms");--> statement-breakpoint
CREATE INDEX "daemon_slots_task_attempt_idx" ON "daemon_slots" USING btree ("last_task_id","last_attempt_n","last_used_at_ms" DESC NULLS LAST);