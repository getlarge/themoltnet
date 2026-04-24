CREATE TYPE "public"."executor_trust_level" AS ENUM('self_declared', 'agent_signed', 'release_verified_tool', 'sandbox_attested');--> statement-breakpoint
CREATE TYPE "public"."executor_verification_status" AS ENUM('verified', 'failed');--> statement-breakpoint
CREATE TABLE "executor_manifest_verifications" (
	"fingerprint" varchar(100) NOT NULL,
	"trust_level" "executor_trust_level" NOT NULL,
	"status" "executor_verification_status" NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executor_manifest_verifications_fingerprint_trust_level_pk" PRIMARY KEY("fingerprint","trust_level")
);
--> statement-breakpoint
CREATE TABLE "executor_manifests" (
	"fingerprint" varchar(100) PRIMARY KEY NOT NULL,
	"manifest" jsonb NOT NULL,
	"schema_version" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "claimed_executor_fingerprint" varchar(100);--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "completed_executor_fingerprint" varchar(100);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "required_executor_trust_level" "executor_trust_level" DEFAULT 'self_declared' NOT NULL;--> statement-breakpoint
ALTER TABLE "executor_manifest_verifications" ADD CONSTRAINT "executor_manifest_verifications_fingerprint_executor_manifests_fingerprint_fk" FOREIGN KEY ("fingerprint") REFERENCES "public"."executor_manifests"("fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executor_manifest_verifications_trust_idx" ON "executor_manifest_verifications" USING btree ("trust_level","status");--> statement-breakpoint
CREATE INDEX "executor_manifests_schema_version_idx" ON "executor_manifests" USING btree ("schema_version");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_executor_manifest_update()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'executor_manifests are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER executor_manifests_no_update
BEFORE UPDATE ON "executor_manifests"
FOR EACH ROW EXECUTE FUNCTION prevent_executor_manifest_update();--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_claimed_executor_fingerprint_executor_manifests_fingerprint_fk" FOREIGN KEY ("claimed_executor_fingerprint") REFERENCES "public"."executor_manifests"("fingerprint") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_completed_executor_fingerprint_executor_manifests_fingerprint_fk" FOREIGN KEY ("completed_executor_fingerprint") REFERENCES "public"."executor_manifests"("fingerprint") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_attempts_claimed_executor_idx" ON "task_attempts" USING btree ("claimed_executor_fingerprint") WHERE claimed_executor_fingerprint IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_attempts_completed_executor_idx" ON "task_attempts" USING btree ("completed_executor_fingerprint") WHERE completed_executor_fingerprint IS NOT NULL;
