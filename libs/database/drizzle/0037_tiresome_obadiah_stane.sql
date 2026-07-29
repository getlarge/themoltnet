CREATE TABLE "runtime_policy_snapshots" (
	"hash" varchar(71) PRIMARY KEY NOT NULL,
	"schema_version" varchar(32) NOT NULL,
	"runtime_kind" varchar(100) NOT NULL,
	"enforcement" varchar(16) NOT NULL,
	"allowed_tools" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_policy_snapshots_hash_format" CHECK ("runtime_policy_snapshots"."hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "runtime_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "runtime_profile_revision" integer;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "policy_snapshot_hash" varchar(71);--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_policy_snapshot_hash_runtime_policy_snapshots_hash_fk" FOREIGN KEY ("policy_snapshot_hash") REFERENCES "public"."runtime_policy_snapshots"("hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_attempts_lease_idx" ON "task_attempts" USING btree ("lease_id") WHERE lease_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_authority_binding_all_or_none" CHECK ((
        lease_id IS NULL
        AND runtime_profile_id IS NULL
        AND runtime_profile_revision IS NULL
        AND policy_snapshot_hash IS NULL
      ) OR (
        lease_id IS NOT NULL
        AND runtime_profile_id IS NOT NULL
        AND runtime_profile_revision IS NOT NULL
        AND runtime_profile_revision > 0
        AND policy_snapshot_hash IS NOT NULL
        AND claimed_executor_fingerprint IS NOT NULL
      ));