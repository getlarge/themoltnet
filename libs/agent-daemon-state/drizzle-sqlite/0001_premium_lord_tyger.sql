CREATE TABLE `daemon_workspaces` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`worktree_path` text NOT NULL,
	`worktree_branch` text,
	`kind` text NOT NULL,
	`refcount` integer DEFAULT 0 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`last_used_at_ms` integer NOT NULL,
	CONSTRAINT "daemon_workspaces_kind_check" CHECK("daemon_workspaces"."kind" IN ('origin', 'fork', 'scratch'))
);
--> statement-breakpoint
DROP TABLE `daemon_slot_workspaces`;--> statement-breakpoint
ALTER TABLE `daemon_slots` ADD `workspace_id` text REFERENCES daemon_workspaces(workspace_id) ON DELETE SET NULL;