import type { MoltnetAgentNode } from './agent.js';

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type Task = Awaited<ReturnType<AgentApi['tasks']['get']>>;
type TaskAttempt = Awaited<
  ReturnType<AgentApi['tasks']['listAttempts']>
>[number];

/** Task statuses that mean the run will not progress further. */
const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

/**
 * A normalized view of a MoltNet task, shared by `moltnet-task-get` and
 * `moltnet-task-wait`. It folds the task record and its attempt list into the
 * shape a downstream `switch`/`function`/agent node actually branches on:
 *
 * - `terminal`  — the task reached a settled status (won't progress)
 * - `accepted`  — an attempt's output was accepted (`acceptedAttemptN` set)
 * - `state`     — the accepted attempt's `output` artifact (the lifecycle
 *                 "phase" payload), or `null` when not yet accepted
 * - `attempt`   — the accepted attempt, or the latest attempt as a fallback
 * - `error`     — the latest failing attempt's error, surfaced for agents/humans
 *                 to interpret and decide the next step (retry, escalate, …)
 */
export interface TaskSnapshot {
  taskId: string;
  status: Task['status'];
  terminal: boolean;
  accepted: boolean;
  acceptedAttemptN: number | null;
  state: Record<string, unknown> | null;
  attempt: TaskAttempt | null;
  attempts: TaskAttempt[];
  error: TaskAttempt['error'] | null;
  task: Task;
}

export function isTerminalTaskStatus(status: Task['status']): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function buildTaskSnapshot(
  task: Task,
  attempts: TaskAttempt[],
): TaskSnapshot {
  const acceptedAttemptN = task.acceptedAttemptN;
  const acceptedAttempt =
    acceptedAttemptN !== null
      ? (attempts.find((a) => a.attemptN === acceptedAttemptN) ?? null)
      : null;
  // Fall back to the highest-numbered attempt so callers always have an
  // attempt to inspect (e.g. to read the error off a failed run).
  const latestAttempt =
    attempts.length > 0
      ? attempts.reduce((max, a) => (a.attemptN > max.attemptN ? a : max))
      : null;
  const attempt = acceptedAttempt ?? latestAttempt;
  const accepted = acceptedAttempt !== null;

  return {
    taskId: task.id,
    status: task.status,
    terminal: isTerminalTaskStatus(task.status),
    accepted,
    acceptedAttemptN,
    state: accepted
      ? ((acceptedAttempt?.output as Record<string, unknown> | null) ?? null)
      : null,
    attempt,
    attempts,
    error: latestAttempt?.error ?? null,
    task,
  };
}
