import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createExecutionPlanCache } from './execution-plan-cache.js';

const slotIdentity = {
  agentName: 'agent',
  runtimeProfileId: 'profile',
  runtimeInstanceId: 'worker',
};
function task(input: Record<string, unknown> = {}, attemptN = 1) {
  return {
    attemptN,
    task: {
      id: 'task-1234',
      teamId: 'team',
      taskType: 'freeform',
      title: null,
      correlationId: 'workflow',
      input: { brief: 'work', ...input },
    },
  } as unknown as Pick<ClaimedTask, 'task' | 'attemptN'>;
}
const continuation = { continueFrom: { taskId: 'producer', attemptN: 1 } };
function resolver(branch: string | null, revision: string | null = null) {
  return {
    findOutputBranch: vi.fn().mockResolvedValue(branch),
    findInputRevision: vi.fn().mockResolvedValue(revision),
  };
}

describe('Durable workspace planning', () => {
  it('caches by attempt and releases plans explicitly', async () => {
    const cache = createExecutionPlanCache({ slotIdentity });
    const claimed = task();
    const first = await cache.getOrCreate(claimed);
    expect(await cache.getOrCreate(claimed)).toBe(first);
    cache.delete(claimed);
    expect(await cache.getOrCreate(claimed)).not.toBe(first);
    expect(first.slotId).toBeNull();
  });
  it('isolates scratch environments by attempt without correlation reuse', async () => {
    const cache = createExecutionPlanCache({ slotIdentity });
    const first = await cache.getOrCreate(
      task({ execution: { workspace: 'none' } }),
    );
    const second = await cache.getOrCreate(
      task({ execution: { workspace: 'none' } }, 2),
    );
    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(first.slotKey).toContain(`workspace:${first.workspaceId}`);
    expect(first.workspaceScope).toBe('session');
  });
  it('reproduces source branches across daemon processes', async () => {
    const sourceAttemptResolver = resolver('feat/source');
    const first = await createExecutionPlanCache({
      slotIdentity,
      sourceAttemptResolver,
    }).getOrCreate(task(continuation));
    const second = await createExecutionPlanCache({
      slotIdentity: { ...slotIdentity, runtimeInstanceId: 'other' },
      sourceAttemptResolver,
    }).getOrCreate(task(continuation));
    expect(first.worktreeBranch).toBe('feat/source');
    expect(first.workspaceId).toBe(second.workspaceId);
    expect(first.slotKey).not.toBe(second.slotKey);
    expect(sourceAttemptResolver.findInputRevision).not.toHaveBeenCalled();
  });
  it('forks from the source branch into a distinct workspace', async () => {
    const sourceAttemptResolver = resolver('feat/source');
    const cache = createExecutionPlanCache({
      slotIdentity,
      sourceAttemptResolver,
    });
    const extend = await cache.getOrCreate(task(continuation));
    const fork = await cache.getOrCreate(
      task({ continueFrom: { ...continuation.continueFrom, mode: 'fork' } }, 2),
    );
    expect(fork.worktreeBaseRef).toBe('feat/source');
    expect(fork.worktreeBranch).toContain('-fork-');
    expect(fork.workspaceId).not.toBe(extend.workspaceId);
  });
  it('restores pinned source revisions when no branch exists', async () => {
    const revision = 'a'.repeat(40);
    const plan = await createExecutionPlanCache({
      slotIdentity,
      sourceAttemptResolver: resolver(null, revision),
    }).getOrCreate(task(continuation));
    expect(plan.workspaceRevision).toBe(revision);
    expect(plan.worktreeBranch).toBeNull();
    expect(plan.workspaceMode).toBe('dedicated_worktree');
  });
  it('allows continuations without Git metadata to use the profile environment', async () => {
    const plan = await createExecutionPlanCache({
      slotIdentity,
      sourceAttemptResolver: resolver(null),
    }).getOrCreate(task(continuation));
    expect(plan.workspaceMode).toBe('shared_mount');
    expect(plan.slotId).toBeNull();
  });
  it('rejects restored worktrees forbidden by the runtime profile', async () => {
    const cache = createExecutionPlanCache({
      slotIdentity,
      sourceAttemptResolver: resolver('feat/source'),
      workspacePolicy: { allowedWorkspaceModes: ['none'] },
    });
    await expect(cache.getOrCreate(task(continuation))).rejects.toThrow(
      'forbids final workspace mode',
    );
  });
  it('rejects pinned revisions when only shared mounts are allowed', async () => {
    const cache = createExecutionPlanCache({
      slotIdentity,
      workspacePolicy: { allowedWorkspaceModes: ['shared_mount'] },
    });
    await expect(
      cache.getOrCreate(task({ execution: { revision: 'a'.repeat(40) } })),
    ).rejects.toThrow('required by a revision-pinned task');
  });
});

it('reproduces a judge target in a separate Git checkout without inheriting its conversation', async () => {
  const claimed = task({ targetTaskId: 'producer', targetAttemptN: 1 });
  claimed.task.taskType = 'judge_eval_attempt';
  const sourceAttemptResolver = resolver('feat/producer');
  const plan = await createExecutionPlanCache({
    slotIdentity,
    sourceAttemptResolver,
  }).getOrCreate(claimed);
  expect(plan.worktreeBaseRef).toBe('feat/producer');
  expect(plan.worktreeBranch).not.toBe('feat/producer');
  expect(plan.workspaceKind).toBe('fork');
});
