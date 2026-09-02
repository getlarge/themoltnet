import type { Task, TaskAttempt } from './client.js';

const terminalStatuses = new Set<Task['status']>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export interface TaskSnapshot {
  accepted: boolean;
  acceptedAttemptN: number | null;
  attempt: TaskAttempt | null;
  attempts: TaskAttempt[];
  error: TaskAttempt['error'] | null;
  state: Record<string, unknown> | null;
  status: Task['status'];
  task: Task;
  taskId: string;
  terminal: boolean;
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
    state: acceptedAttempt?.output ?? null,
    attempt,
    attempts,
    error: latestAttempt?.error ?? null,
    task,
  };
}
