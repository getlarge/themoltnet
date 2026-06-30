CREATE TYPE "public"."task_cleanup_job_reason" AS ENUM('retention');--> statement-breakpoint
CREATE TYPE "public"."task_cleanup_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "task_cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"reason" "task_cleanup_job_reason" NOT NULL,
	"status" "task_cleanup_job_status" DEFAULT 'pending' NOT NULL,
	"workflow_id" text,
	"manifest" jsonb,
	"error" jsonb,
	"object_count" integer DEFAULT 0 NOT NULL,
	"object_bytes" bigint DEFAULT 0 NOT NULL,
	"deleted_task_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_cleanup_jobs_object_count_non_negative" CHECK (object_count >= 0),
	CONSTRAINT "task_cleanup_jobs_object_bytes_non_negative" CHECK (object_bytes >= 0),
	CONSTRAINT "task_cleanup_jobs_deleted_task_count_non_negative" CHECK (deleted_task_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "task_cleanup_jobs" ADD CONSTRAINT "task_cleanup_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_cleanup_jobs_task_idx" ON "task_cleanup_jobs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_cleanup_jobs_workflow_idx" ON "task_cleanup_jobs" USING btree ("workflow_id") WHERE workflow_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_cleanup_jobs_status_idx" ON "task_cleanup_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "task_cleanup_jobs_team_idx" ON "task_cleanup_jobs" USING btree ("team_id");