import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createMoltNetRepairAdapter } from './moltnet-repair.js';

type Task = Awaited<ReturnType<Agent['tasks']['get']>>;
type Attempt = Awaited<ReturnType<Agent['tasks']['listAttempts']>>[number];
const args = {
  key: 'absurd:repair-1',
  round: 1,
  deadline: Number.MAX_SAFE_INTEGER,
  reasons: ['check:test'],
  revision: {
    base: 'base',
    head: 'head',
    policyDigest: 'policy',
    briefDigest: 'brief',
  },
};
function setup() {
  const task = {
    id: 'task',
    status: 'running',
    acceptedAttemptN: null,
  } as Task;
  const tasks = {
    list: vi
      .fn<Agent['tasks']['list']>()
      .mockResolvedValue({ items: [], total: 0 }),
    create: vi
      .fn<Parameters<typeof createMoltNetRepairAdapter>[0]['tasks']['create']>()
      .mockResolvedValue(task),
    get: vi.fn<Agent['tasks']['get']>().mockResolvedValue(task),
    listAttempts: vi.fn<Agent['tasks']['listAttempts']>().mockResolvedValue([]),
    cancel: vi
      .fn<Agent['tasks']['cancel']>()
      .mockResolvedValue({ ...task, status: 'cancelled' }),
  };
  const canDispatch = vi.fn().mockResolvedValue(true);
  const verifyOutput = vi.fn().mockReturnValue(true);
  const adapter = createMoltNetRepairAdapter({
    tasks,
    teamId: 'team',
    proposerAgentId: 'agent',
    canDispatch,
    verifyOutput,
    body: () => ({
      taskType: 'fulfill_brief',
      diaryId: 'diary',
      input: {},
      maxAttempts: 1,
    }),
  });
  return { adapter, tasks, task, canDispatch, verifyOutput };
}

describe('MoltNet repair adapter', () => {
  it('recovers a lost creation acknowledgement before checking a changed revision', async () => {
    const { adapter, tasks, task, canDispatch } = setup();
    tasks.list.mockResolvedValueOnce({ items: [task], total: 0 });
    canDispatch.mockResolvedValue(false);
    expect(await adapter.startRepair(args)).toEqual({ taskId: 'task' });
    expect(canDispatch).not.toHaveBeenCalled();
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [expect.stringMatching(/^sdlc-operation:/)],
      }),
      { teamId: 'team', idempotencyKey: args.key },
    );
  });
  it('does not create new work after admission is revoked', async () => {
    const { adapter, tasks, canDispatch } = setup();
    canDispatch.mockResolvedValue(false);
    expect(await adapter.startRepair(args)).toBeNull();
    expect(tasks.create).not.toHaveBeenCalled();
  });
  it('does not dispatch a new repair after its persisted deadline', async () => {
    const { adapter, tasks, canDispatch } = setup();
    expect(await adapter.startRepair({ ...args, deadline: 0 })).toBeNull();
    expect(tasks.create).not.toHaveBeenCalled();
    expect(canDispatch).not.toHaveBeenCalled();
  });
  it('preserves server key/body conflicts on recovery', async () => {
    const { adapter, tasks, task } = setup();
    tasks.list.mockResolvedValue({ items: [task], total: 0 });
    tasks.create.mockRejectedValue(new Error('idempotency conflict'));
    await expect(adapter.startRepair(args)).rejects.toThrow(
      'idempotency conflict',
    );
  });
  it('rejects ambiguous operation provenance', async () => {
    const { adapter, tasks, task } = setup();
    tasks.list.mockResolvedValue({
      items: [task, task],
      total: 0,
    });
    await expect(adapter.startRepair(args)).rejects.toThrow('Ambiguous');
    expect(tasks.create).not.toHaveBeenCalled();
  });
  it('requires an accepted completed attempt and validates its output', async () => {
    const { adapter, tasks, task, verifyOutput } = setup();
    tasks.get.mockResolvedValue({
      ...task,
      status: 'completed',
      acceptedAttemptN: 2,
    });
    const receipt = { taskId: task.id };
    expect(await adapter.repairState(receipt)).toBe('failed');
    tasks.listAttempts.mockResolvedValue([
      {
        taskId: task.id,
        attemptN: 2,
        status: 'completed',
        outputCid: 'cid',
        output: { result: 'fixed' },
        claimedAt: '2026-10-29T00:00:00Z',
        claimedByAgentId: 'worker',
        claimedExecutorFingerprint: null,
        claimedExecutorManifest: null,
        completedAt: '2026-10-29T00:01:00Z',
        completedExecutorFingerprint: null,
        completedExecutorManifest: null,
        contentSignature: null,
        daemonState: null,
        error: null,
        leaseId: null,
        policySnapshotHash: null,
        runtimeId: null,
        runtimeProfileId: null,
        runtimeProfileRevision: null,
        signedAt: null,
        startedAt: null,
        usage: null,
      } satisfies Attempt,
    ]);
    expect(await adapter.repairState(receipt)).toBe('accepted');
    expect(verifyOutput).toHaveBeenCalledWith(
      { result: 'fixed' },
      { taskId: task.id, attempt: 2, outputCid: 'cid' },
    );
    verifyOutput.mockReturnValue(false);
    expect(await adapter.repairState(receipt)).toBe('failed');
  });
  it('reconciles a lost cancellation acknowledgement', async () => {
    const { adapter, tasks, task } = setup();
    tasks.get
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce({ ...task, status: 'cancelled' });
    tasks.cancel.mockRejectedValue(new Error('connection lost'));
    await adapter.cancelRepair({ taskId: task.id }, 'stop');
    expect(tasks.cancel).toHaveBeenCalledWith(task.id, expect.anything(), {
      teamId: 'team',
    });
  });
  it('does not swallow cancellation failure while the task is running', async () => {
    const { adapter, tasks, task } = setup();
    tasks.cancel.mockRejectedValue(new Error('forbidden'));
    await expect(
      adapter.cancelRepair({ taskId: task.id }, 'stop'),
    ).rejects.toThrow('forbidden');
  });
});
