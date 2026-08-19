UPDATE "tasks"
SET "completed_at" = COALESCE(
	(
		SELECT "task_attempts"."completed_at"
		FROM "task_attempts"
		WHERE "task_attempts"."task_id" = "tasks"."id"
			AND "task_attempts"."status"::text IN ('completed', 'failed', 'cancelled', 'aborted', 'timed_out')
			AND "task_attempts"."completed_at" IS NOT NULL
		ORDER BY "task_attempts"."attempt_n" DESC
		LIMIT 1
	),
	"tasks"."updated_at",
	"tasks"."created_at"
)
WHERE "tasks"."status" IN ('completed', 'failed', 'cancelled', 'expired')
	AND "tasks"."completed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_request_cid" varchar(100);--> statement-breakpoint
-- Preserve the oldest pending transfer for each diary and reject any newer
-- duplicates before enforcing the invariant. Existing accepted/rejected/
-- expired transfers are intentionally untouched.
WITH "ranked_pending_transfers" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "diary_id"
			ORDER BY "created_at" ASC, "id" ASC
		) AS "pending_rank"
	FROM "diary_transfers"
	WHERE "status" = 'pending'
)
UPDATE "diary_transfers" AS "transfer"
SET
	"status" = 'rejected',
	"resolved_at" = COALESCE("transfer"."resolved_at", now()),
	"updated_at" = now()
FROM "ranked_pending_transfers" AS "ranked"
WHERE
	"transfer"."id" = "ranked"."id"
	AND "ranked"."pending_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "diary_transfers_one_pending_per_diary_idx" ON "diary_transfers" USING btree ("diary_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_agent_idempotency_idx" ON "tasks" USING btree ("team_id","proposed_by_agent_id","idempotency_key_hash") WHERE idempotency_key_hash IS NOT NULL AND proposed_by_agent_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_human_idempotency_idx" ON "tasks" USING btree ("team_id","proposed_by_human_id","idempotency_key_hash") WHERE idempotency_key_hash IS NOT NULL AND proposed_by_human_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_idempotency_columns_together" CHECK ((idempotency_key_hash IS NULL) = (idempotency_request_cid IS NULL));
