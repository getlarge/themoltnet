import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it, vi } from 'vitest';

import {
  guardWorkers,
  type WorkerJob,
  WorkerUnavailableError,
  workflowWorkerLiveness,
} from '../src/workers.js';

function client(statuses: string[]) {
  const getTask = vi.fn((id: string) =>
    Promise.resolve({ id, status: statuses.shift() ?? 'queued' }),
  );
  const createTask = vi.fn(() =>
    Promise.resolve({ id: 'task-1', status: 'queued' }),
  );
  return {
    tasks: {
      createTask,
      getTask,
      listAttempts: vi.fn(() => Promise.resolve([])),
    } as unknown as TaskClient,
    createTask,
    getTask,
  };
}

describe('guardWorkers', () => {
  it('returns the task client unchanged without a liveness source', () => {
    const { tasks } = client([]);

    expect(guardWorkers(tasks, 'security', undefined)).toBe(tasks);
  });

  it('refuses to create a task once the pool stopped', async () => {
    const { tasks, createTask } = client([]);
    const guarded = guardWorkers(tasks, 'focused', {
      stopped: () => Promise.resolve(true),
    });

    await expect(
      guarded.createTask({} as never, { idempotencyKey: 'key' }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('keeps polling while workers run', async () => {
    const { tasks } = client(['queued']);
    const guarded = guardWorkers(tasks, 'docs', {
      stopped: () => Promise.resolve(false),
    });

    await expect(guarded.getTask('task-1')).resolves.toMatchObject({
      status: 'queued',
    });
  });

  it('fails an unfinished task once the pool stopped', async () => {
    const { tasks, getTask } = client(['queued', 'running']);
    const guarded = guardWorkers(tasks, 'docs', {
      stopped: () => Promise.resolve(true),
    });

    await expect(guarded.getTask('task-1')).rejects.toThrow(
      'docs review worker stopped before the task finished',
    );
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('returns a task the worker finished just before it exited', async () => {
    const { tasks } = client(['running', 'completed']);
    const stopped = vi.fn(() => Promise.resolve(true));
    const guarded = guardWorkers(tasks, 'complexity', { stopped });

    await expect(guarded.getTask('task-1')).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('does not consult liveness for a terminal task', async () => {
    const { tasks } = client(['failed']);
    const stopped = vi.fn(() => Promise.resolve(true));
    const guarded = guardWorkers(tasks, 'security', { stopped });

    await expect(guarded.getTask('task-1')).resolves.toMatchObject({
      status: 'failed',
    });
    expect(stopped).not.toHaveBeenCalled();
  });
});

describe('workflowWorkerLiveness', () => {
  const profiles = { security: 'security-v2', focused: 'focused-v1' };

  function liveness(jobs: WorkerJob[] | Error, now = () => 0) {
    const listJobs = vi.fn(() =>
      jobs instanceof Error ? Promise.reject(jobs) : Promise.resolve(jobs),
    );
    const onLookupError = vi.fn();
    return {
      listJobs,
      onLookupError,
      liveness: workflowWorkerLiveness({
        listJobs,
        profiles,
        now,
        onLookupError,
      }),
    };
  }

  it.each([
    [[{ name: 'classifier-worker', status: 'completed' }], true],
    [[{ name: 'review / classifier-worker', status: 'completed' }], true],
    [[{ name: 'review / classifier-worker', status: 'in_progress' }], false],
    [[{ name: 'review / classifier-worker', status: 'queued' }], false],
    [[{ name: 'review / review', status: 'in_progress' }], false],
  ])('reads classifier liveness from %j', async (jobs, stopped) => {
    await expect(liveness(jobs).liveness.stopped('classifier')).resolves.toBe(
      stopped,
    );
  });

  it('waits until every matrix worker of a profile has stopped', async () => {
    const { liveness: running } = liveness([
      { name: 'review / Specialist focused-v1 #1', status: 'completed' },
      { name: 'review / Specialist focused-v1 #2', status: 'in_progress' },
      { name: 'review / Specialist security-v2 #1', status: 'completed' },
    ]);

    await expect(running.stopped('focused')).resolves.toBe(false);
    await expect(running.stopped('security')).resolves.toBe(true);
  });

  it('does not match a profile that only shares a prefix', async () => {
    const { liveness: other } = liveness([
      { name: 'review / Specialist security-v2-extra #1', status: 'completed' },
    ]);

    await expect(other.stopped('security')).resolves.toBe(false);
  });

  it('treats an unconfigured or absent pool as live', async () => {
    const { liveness: none } = liveness([
      { name: 'review / Specialist undefined #1', status: 'completed' },
    ]);

    await expect(none.stopped('docs')).resolves.toBe(false);
    await expect(none.stopped('focused')).resolves.toBe(false);
  });

  it('treats a failed job lookup as live and reports it', async () => {
    const { liveness: failing, onLookupError } = liveness(new Error('403'));

    await expect(failing.stopped('security')).resolves.toBe(false);
    expect(onLookupError).toHaveBeenCalledOnce();
  });

  it('reuses one job listing within the cache window', async () => {
    let clock = 0;
    const { liveness: cached, listJobs } = liveness([], () => clock);

    await cached.stopped('security');
    await cached.stopped('focused');
    clock = 29_999;
    await cached.stopped('classifier');
    expect(listJobs).toHaveBeenCalledOnce();
    clock = 30_000;
    await cached.stopped('classifier');
    expect(listJobs).toHaveBeenCalledTimes(2);
  });
});
