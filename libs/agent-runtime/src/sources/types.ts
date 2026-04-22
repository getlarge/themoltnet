import type { Task } from '@moltnet/tasks';

/**
 * A pull-based queue of tasks ready to execute.
 *
 * Contract: `TaskSource` is the ONLY way `AgentRuntime` learns about work.
 * Whether tasks come from a local JSON file, stdin, or an HTTP
 * `POST /agent-runtimes/:id/tasks/claim` call is the source's concern — so
 * `AgentRuntime` is identical in local and API modes (the other half of the
 * PR 0 ↔ PR 7 swap, alongside `TaskReporter`).
 *
 * Sources are single-use unless documented otherwise: PR 0 sources yield
 * one task then return `null`. PR 7's `ApiTaskSource` will long-poll.
 */
export interface TaskSource {
  /**
   * Claim the next task, or resolve `null` when the source is exhausted.
   * Implementations MAY block (e.g. long-polling); callers drive the loop.
   */
  claim(): Promise<Task | null>;

  /**
   * Release resources (file handles, HTTP clients). Called once by the
   * runtime after the loop exits. Idempotent.
   */
  close(): Promise<void>;
}
