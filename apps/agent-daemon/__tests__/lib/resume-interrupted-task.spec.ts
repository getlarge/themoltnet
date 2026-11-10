import { setTimeout as delay } from 'node:timers/promises';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { type Agent, NetworkError } from '@themoltnet/sdk';
import { beforeEach, expect, it, vi } from 'vitest';

import { resumeInterruptedTask } from '../../src/lib/resume-interrupted-task.js';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const task = {
    id: 'task',
    teamId: 'team',
    projectId: 'project',
    status: 'running',
  };
  const attempt = {
    attemptN: 1,
    status: 'running',
    claimedByAgentId: 'agent',
    runtimeProfileId: 'profile',
    claimedExecutorFingerprint: 'executor',
    leaseId: 'lease',
    runtimeProfileRevision: 2,
    policySnapshotHash: 'policy',
  };
  const identity = { subjectType: 'agent', subjectId: 'agent' };
  const agent = {
    agents: { whoami: vi.fn(async () => identity) },
    tasks: {
      get: vi.fn(async () => task),
      listAttempts: vi.fn(async () => [attempt]),
      claim: vi.fn(),
    },
  };
  const claimed = {
    task: { ...task },
    attemptN: 1,
    profileId: 'profile',
    claimAuthority: {
      leaseId: 'lease',
      executorFingerprint: 'executor',
      runtimeProfileRevision: 2,
      policySnapshotHash: 'policy',
    },
    traceHeaders: { traceparent: 'original-trace' },
  } as unknown as ClaimedTask;
  const abort = new AbortController();
  const input = {
    agent: agent as unknown as Agent,
    claimed,
    executorFingerprint: 'executor',
    manifest: {
      durability: {
        format: 'pi-durable.v1',
        recovery: 'same-agent-valid-lease',
        workspace: 'persistent-mount',
      },
    },
    signal: abort.signal,
  };
  return { agent, identity, task, attempt, input, abort };
}

it('waits for writer expiry then reattaches with original authority and trace', async () => {
  const f = fixture();
  const resumed = await resumeInterruptedTask(f.input);
  expect(delay).toHaveBeenCalledWith(30_000, undefined, {
    signal: f.abort.signal,
  });
  expect(resumed).toMatchObject({
    attemptN: 1,
    task: f.task,
    claimAuthority: f.input.claimed.claimAuthority,
    traceHeaders: f.input.claimed.traceHeaders,
  });
  expect(f.agent.tasks.claim).not.toHaveBeenCalled();
  expect(f.agent.tasks.get).toHaveBeenCalledWith('task', {
    teamId: 'team',
    signal: expect.any(AbortSignal),
  });
});

it('retries transient reconciliation reads after an API outage', async () => {
  const f = fixture();
  f.agent.tasks.get.mockRejectedValueOnce(new NetworkError('unavailable'));
  expect(await resumeInterruptedTask(f.input)).not.toBeNull();
  expect(vi.mocked(delay).mock.calls.map(([ms]) => ms)).toEqual([
    30_000, 5_000,
  ]);
  expect(f.agent.tasks.claim).not.toHaveBeenCalled();
});

it('bounds persistent outages', async () => {
  const f = fixture();
  f.agent.tasks.get.mockRejectedValue(new NetworkError('unavailable'));
  expect(await resumeInterruptedTask(f.input)).toBeNull();
  expect(f.agent.tasks.get).toHaveBeenCalledTimes(3);
  expect(f.agent.tasks.claim).not.toHaveBeenCalled();
});

it.each(['lease', 'revision', 'policy'])(
  'refuses changed %s authority',
  async (field) => {
    const f = fixture();
    if (field === 'lease') f.attempt.leaseId = 'replacement';
    if (field === 'revision') f.attempt.runtimeProfileRevision = 3;
    if (field === 'policy') f.attempt.policySnapshotHash = 'replacement';
    expect(await resumeInterruptedTask(f.input)).toBeNull();
    expect(f.agent.tasks.claim).not.toHaveBeenCalled();
  },
);

it.each(['identity', 'executor', 'profile', 'project', 'expired', 'terminal'])(
  'refuses %s changes without retrying',
  async (field) => {
    const f = fixture();
    if (field === 'identity') f.identity.subjectId = 'other';
    if (field === 'executor') f.attempt.claimedExecutorFingerprint = 'other';
    if (field === 'profile') f.attempt.runtimeProfileId = 'other';
    if (field === 'project') f.task.projectId = 'other';
    if (field === 'expired') f.attempt.status = 'timed_out';
    if (field === 'terminal') f.task.status = 'cancelled';
    await expect(resumeInterruptedTask(f.input)).rejects.toThrow(
      'Resume requires',
    );
    expect(delay).toHaveBeenCalledTimes(1);
    expect(f.agent.tasks.claim).not.toHaveBeenCalled();
  },
);

it('does not opt non-durable adapters into replay', async () => {
  const f = fixture();
  f.input.manifest.durability.recovery = 'none';
  expect(await resumeInterruptedTask(f.input)).toBeNull();
  expect(delay).not.toHaveBeenCalled();
  expect(f.agent.tasks.get).not.toHaveBeenCalled();
});

it('stops recovery when shutdown cancels the wait', async () => {
  const f = fixture();
  const error = new Error('shutdown');
  vi.mocked(delay).mockRejectedValueOnce(error);
  await expect(resumeInterruptedTask(f.input)).rejects.toBe(error);
  expect(f.agent.tasks.get).not.toHaveBeenCalled();
});
