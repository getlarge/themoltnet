ALTER TABLE "runtime_profiles" ADD COLUMN "default_workspace_mode" varchar(32);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "allowed_workspace_modes" text[] DEFAULT ARRAY['none','shared_mount','dedicated_worktree']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "max_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD COLUMN "max_bash_timeouts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_max_turns_non_negative" CHECK (max_turns >= 0);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_max_bash_timeouts_non_negative" CHECK (max_bash_timeouts >= 0);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_default_workspace_mode_valid" CHECK (default_workspace_mode IS NULL OR default_workspace_mode = ANY(ARRAY['none','shared_mount','dedicated_worktree']::text[]));--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_allowed_workspace_modes_nonempty" CHECK (cardinality(allowed_workspace_modes) BETWEEN 1 AND 3);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_allowed_workspace_modes_valid" CHECK (allowed_workspace_modes <@ ARRAY['none','shared_mount','dedicated_worktree']::text[]);--> statement-breakpoint
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_default_workspace_mode_allowed" CHECK (default_workspace_mode IS NULL OR default_workspace_mode = ANY(allowed_workspace_modes));