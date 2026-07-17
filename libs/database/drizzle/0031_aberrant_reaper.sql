-- Task input artifacts (#1599): NULL attempt_n = input artifact bound at
-- task creation; NULL created_by_agent_id = bound by a human proposer.
-- ROLLBACK NOTE: this migration is one-way once NULL rows exist —
-- re-adding NOT NULL requires deleting or backfilling input-artifact
-- rows first. The partial unique index matches zero rows at migrate
-- time, so the (non-CONCURRENT) index build is a no-op scan.
ALTER TABLE "task_artifacts" ALTER COLUMN "attempt_n" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task_artifacts" ALTER COLUMN "created_by_agent_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_artifacts_input_cid_idx" ON "task_artifacts" USING btree ("team_id","task_id","cid") WHERE attempt_n IS NULL;