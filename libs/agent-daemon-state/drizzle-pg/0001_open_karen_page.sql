CREATE TABLE "daemon_workspaces" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"worktree_path" text NOT NULL,
	"worktree_branch" text,
	"kind" text NOT NULL,
	"refcount" integer DEFAULT 0 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"last_used_at_ms" bigint NOT NULL,
	CONSTRAINT "daemon_workspaces_kind_check" CHECK ("daemon_workspaces"."kind" IN ('origin', 'fork', 'scratch'))
);
--> statement-breakpoint
ALTER TABLE "daemon_slot_workspaces" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "daemon_slot_workspaces" CASCADE;--> statement-breakpoint
ALTER TABLE "daemon_slots" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "daemon_slots" ADD CONSTRAINT "daemon_slots_workspace_id_daemon_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."daemon_workspaces"("workspace_id") ON DELETE set null ON UPDATE no action;