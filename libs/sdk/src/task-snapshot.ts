import type { Agent } from './agent.js';

type Task = Awaited<ReturnType<Agent['tasks']['get']>>;
type TaskAttempt = Awaited<ReturnType<Agent['tasks']['listAttempts']>>[number];

const terminalStatuses = new Set<Task['status']>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

/** Host-neutral terminal task view used by workflow integrations. */
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
  return terminalStatuses.has(status);
}

export function buildTaskSnapshot(
  task: Task,
  attempts: TaskAttempt[],
): TaskSnapshot {
  const acceptedAttempt =
    task.acceptedAttemptN === null
      ? null
      : (attempts.find(
          (attempt) => attempt.attemptN === task.acceptedAttemptN,
        ) ?? null);
  const latestAttempt = attempts.reduce<TaskAttempt | null>(
    (latest, attempt) =>
      latest === null || attempt.attemptN > latest.attemptN ? attempt : latest,
    null,
  );
  const attempt = acceptedAttempt ?? latestAttempt;

  return {
    taskId: task.id,
    status: task.status,
    terminal: isTerminalTaskStatus(task.status),
    accepted: acceptedAttempt !== null,
    acceptedAttemptN: task.acceptedAttemptN,
    state:
      acceptedAttempt === null
        ? null
        : ((acceptedAttempt.output as Record<string, unknown> | null) ?? null),
    attempt,
    attempts,
    error: latestAttempt?.error ?? null,
    task,
  };
}
