import {
  getTaskExecutionPolicy,
  type Task,
  type TaskExecutionPolicy,
} from '@moltnet/tasks';

type TaskKeyInput = Pick<Task, 'taskType' | 'correlationId' | 'id' | 'input'>;

export interface TaskSessionDescriptor {
  policy: TaskExecutionPolicy;
  /**
   * Daemon-local warm-session reuse key. `null` means this task must
   * cold-start a fresh executor context or otherwise must not be reused.
   */
  sessionKey: string | null;
}

/**
 * Resolve the daemon-facing execution policy for a task and, when the task
 * type permits warm reuse, compute the daemon-local `sessionKey`.
 *
 * `correlationId` remains the audit/query key; `sessionKey` is narrower and
 * may fold in task-type-specific discriminators so eval/review flows stay
 * isolated even inside one correlation group.
 */
export function deriveTaskSessionDescriptor(
  task: TaskKeyInput,
): TaskSessionDescriptor {
  const policy = getTaskExecutionPolicy(task.taskType);
  return {
    policy,
    sessionKey: buildTaskSessionKey(task, policy),
  };
}

function buildTaskSessionKey(
  task: TaskKeyInput,
  policy: TaskExecutionPolicy,
): string | null {
  if (!policy.resumable) return null;

  switch (policy.sessionScope) {
    case 'none':
      return null;
    case 'correlation':
      return task.correlationId
        ? `${task.taskType}:correlation:${task.correlationId}`
        : null;
    case 'custom':
      return buildCustomSessionKey(task);
  }
}

function buildCustomSessionKey(task: TaskKeyInput): string | null {
  switch (task.taskType) {
    case 'run_eval': {
      const variantLabel =
        typeof (task.input as { variantLabel?: unknown }).variantLabel ===
        'string'
          ? (task.input as { variantLabel: string }).variantLabel
          : null;
      if (!task.correlationId || !variantLabel) return null;
      return `run_eval:correlation:${task.correlationId}:variant:${slugifySessionComponent(variantLabel)}`;
    }

    case 'judge_eval_variant': {
      const runTaskIds = Array.isArray(
        (task.input as { runTaskIds?: unknown }).runTaskIds,
      )
        ? (task.input as { runTaskIds: unknown[] }).runTaskIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      if (runTaskIds.length < 1) return null;
      return `judge_eval_variant:run_tasks:${[...runTaskIds].sort().join(',')}`;
    }

    default:
      return null;
  }
}

function slugifySessionComponent(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
