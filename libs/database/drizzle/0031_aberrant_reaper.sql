ALTER TABLE "task_artifacts" ALTER COLUMN "attempt_n" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task_artifacts" ALTER COLUMN "created_by_agent_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_artifacts_input_cid_idx" ON "task_artifacts" USING btree ("team_id","task_id","cid") WHERE attempt_n IS NULL;