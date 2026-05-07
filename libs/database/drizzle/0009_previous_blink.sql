ALTER TABLE "task_attempts" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "criteria_cid";