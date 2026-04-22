import type { TaskMessage, TaskUsage } from '@moltnet/tasks';

/**
 * Append-only event sink for a single task attempt.
 *
 * Contract: `TaskReporter` is the ONLY I/O surface `executeTask` has.
 * Whether events go to stdout, a JSONL file, or an HTTP POST is the
 * reporter's concern — so `executeTask` is identical in local and API
 * modes (the single abstraction that lets PR 7 be pure plumbing).
 *
 * Records written via `record()` carry a monotonic `seq` per
 * `(task_id, attempt_n)`; reporters assign it internally.
 *
 * Reporters MUST be idempotent on replay: if the same `seq` is seen
 * twice with the same payload, that's a reconnect, not a bug.
 */
export interface TaskReporter {
  /**
   * Open the reporter for a specific attempt. Called once before any
   * `record()` calls. Reporters that don't need per-attempt state can
   * return immediately.
   */
  open(ctx: { taskId: string; attemptN: number }): Promise<void>;

  /**
   * Record one event. `seq`, `timestamp`, `task_id`, `attempt_n` are
   * supplied by the reporter — callers pass the body only.
   */
  record(
    body: Omit<TaskMessage, 'task_id' | 'attempt_n' | 'seq' | 'timestamp'>,
  ): Promise<void>;

  /**
   * Final accounting. Writes a summary the runtime can surface; does
   * NOT imply a particular output kind (completion vs failure).
   */
  finalize(usage: TaskUsage): Promise<void>;

  /** Flush buffers + release resources. Called once. Idempotent. */
  close(): Promise<void>;
}
