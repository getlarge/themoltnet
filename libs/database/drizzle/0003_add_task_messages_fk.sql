-- Composite FK: task_messages(task_id, attempt_n) → task_attempts(task_id, attempt_n)
-- Drizzle's FK API does not support composite foreign keys, so this is added manually.
ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_attempt_fk"
    FOREIGN KEY ("task_id", "attempt_n")
    REFERENCES "task_attempts" ("task_id", "attempt_n")
    ON DELETE CASCADE;