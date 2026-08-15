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
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_terminal_completed_at_required" CHECK (status NOT IN ('completed', 'failed', 'cancelled', 'expired') OR completed_at IS NOT NULL);
