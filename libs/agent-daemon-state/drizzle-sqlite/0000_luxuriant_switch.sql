CREATE TABLE `daemon_slot_sessions` (
	`agent_name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`slot_key` text NOT NULL,
	`session_dir` text NOT NULL,
	`session_path` text,
	PRIMARY KEY(`agent_name`, `provider`, `model`, `slot_key`),
	FOREIGN KEY (`agent_name`,`provider`,`model`,`slot_key`) REFERENCES `daemon_slots`(`agent_name`,`provider`,`model`,`slot_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daemon_slot_sessions_session_dir_unique` ON `daemon_slot_sessions` (`session_dir`);--> statement-breakpoint
CREATE TABLE `daemon_slot_workspaces` (
	`agent_name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`slot_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`worktree_path` text NOT NULL,
	`worktree_branch` text,
	PRIMARY KEY(`agent_name`, `provider`, `model`, `slot_key`),
	FOREIGN KEY (`agent_name`,`provider`,`model`,`slot_key`) REFERENCES `daemon_slots`(`agent_name`,`provider`,`model`,`slot_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daemon_slot_workspaces_workspace_id_unique` ON `daemon_slot_workspaces` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `daemon_slots` (
	`agent_name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`slot_key` text NOT NULL,
	`task_type` text NOT NULL,
	`state` text NOT NULL,
	`last_task_id` text NOT NULL,
	`last_attempt_n` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`last_used_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	PRIMARY KEY(`agent_name`, `provider`, `model`, `slot_key`),
	CONSTRAINT "daemon_slots_state_check" CHECK("daemon_slots"."state" IN ('active', 'idle'))
);
--> statement-breakpoint
CREATE INDEX `daemon_slots_expires_idx` ON `daemon_slots` (`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `daemon_slots_task_attempt_idx` ON `daemon_slots` (`last_task_id`,`last_attempt_n`,"last_used_at_ms" DESC);