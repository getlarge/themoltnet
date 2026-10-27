import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import type { Lane } from './core.js';

/** The worker jobs that can claim one kind of adaptive review task. */
export type WorkerPool =
  | 'classifier'
  | 'docs'
  | 'complexity'
  | 'security'
  | 'focused';

/** The specialist pool whose workers claim a lane's tasks. */
export function workerPool(lane: Lane): Exclude<WorkerPool, 'classifier'> {
  return lane === 'tests' || lane === 'conventions' || lane === 'blast-radius'
    ? 'focused'
    : lane;
}

/** Reports whether every worker job that could claim a pool's tasks has stopped. */
export interface WorkerLiveness {
  stopped(pool: WorkerPool): Promise<boolean>;
}

/** Raised instead of waiting for a task that no running worker can claim. */
export class WorkerUnavailableError extends Error {
  readonly pool: WorkerPool;

  constructor(pool: WorkerPool) {
    super(`${pool} review worker stopped before the task finished`);
    this.name = 'WorkerUnavailableError';
    this.pool = pool;
  }
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);

/**
 * Fails task creation and polling once the pool's workers have stopped, so a
 * worker that never started does not hold the review until the job timeout.
 */
export function guardWorkers(
  tasks: TaskClient,
  pool: WorkerPool,
  liveness: WorkerLiveness | undefined,
): TaskClient {
  if (!liveness) return tasks;
  const listMessages = tasks.listMessages?.bind(tasks);
  return {
    async createTask(body, options) {
      if (await liveness.stopped(pool)) throw new WorkerUnavailableError(pool);
      return tasks.createTask(body, options);
    },
    async getTask(id) {
      const task = await tasks.getTask(id);
      if (TERMINAL.has(task.status) || !(await liveness.stopped(pool)))
        return task;
      // A worker can finish the task just before its job exits.
      const latest = await tasks.getTask(id);
      if (TERMINAL.has(latest.status)) return latest;
      throw new WorkerUnavailableError(pool);
    },
    listAttempts: (id) => tasks.listAttempts(id),
    ...(listMessages ? { listMessages } : {}),
  };
}

export interface WorkerJob {
  name: string;
  status: string;
}

/**
 * Reads worker liveness from the jobs of the current workflow run attempt.
 * Worker job names follow the adaptive review workflow: `classifier-worker`
 * and `Specialist <profile> #<n>`, optionally prefixed by the caller's job
 * name. A pool with no matching job, or a failed job lookup, counts as live.
 */
export function workflowWorkerLiveness(options: {
  listJobs: () => Promise<WorkerJob[]>;
  profiles: Partial<Record<WorkerPool, string>>;
  cacheMs?: number;
  now?: () => number;
  onLookupError?: (error: unknown) => void;
}): WorkerLiveness {
  const { listJobs, profiles, cacheMs = 30_000, now = Date.now } = options;
  let cached: { at: number; jobs: Promise<WorkerJob[] | null> } | undefined;
  const jobs = () => {
    if (!cached || now() - cached.at >= cacheMs) {
      cached = {
        at: now(),
        jobs: listJobs().catch((error: unknown) => {
          options.onLookupError?.(error);
          return null;
        }),
      };
    }
    return cached.jobs;
  };
  const matches = (pool: WorkerPool, job: WorkerJob): boolean => {
    const caller = job.name.lastIndexOf(' / ');
    const name = caller < 0 ? job.name : job.name.slice(caller + 3);
    if (pool === 'classifier') return name === 'classifier-worker';
    const prefix = `Specialist ${profiles[pool]} #`;
    return (
      profiles[pool] !== undefined &&
      name.startsWith(prefix) &&
      /^\d+$/.test(name.slice(prefix.length))
    );
  };
  return {
    async stopped(pool) {
      const listed = await jobs();
      const workers = listed?.filter((job) => matches(pool, job)) ?? [];
      return (
        workers.length > 0 && workers.every((job) => job.status === 'completed')
      );
    },
  };
}
