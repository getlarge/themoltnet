import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { ApiTaskSource } from './api.js';

function makeAgent(claimImpl: TasksNamespace['claim']): Agent {
  return {
    tasks: {
      claim: claimImpl,
    },
  } as unknown as Agent;
}

describe('ApiTaskSource', () => {
  it('claims one task and returns the API attempt number', async () => {
    const task = makeFulfillBriefTask({ status: 'dispatched' });
    const claimMock = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: {
        taskId: task.id,
        attemptN: 3,
        claimedByAgentId: '33333333-3333-4333-8333-333333333333',
        runtimeId: null,
        leaseId: '44444444-4444-4444-8444-444444444444',
        runtimeProfileId: '55555555-5555-4555-8555-555555555555',
        runtimeProfileRevision: 1,
        policySnapshotHash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        claimedAt: '2026-04-23T10:00:00Z',
        startedAt: null,
        completedAt: null,
        status: 'claimed',
        output: null,
        outputCid: null,
        error: null,
        usage: null,
        contentSignature: null,
        signedAt: null,
        claimedExecutorFingerprint: 'bafkreiexecutor',
        claimedExecutorManifest: null,
        completedExecutorFingerprint: null,
        completedExecutorManifest: null,
        daemonState: null,
      },
      traceHeaders: { traceparent: '00-abc-def-01' },
    });

    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: task.id,
    });

    await expect(src.claim()).resolves.toEqual({
      task,
      attemptN: 3,
      claimAuthority: {
        claimantAgentId: '33333333-3333-4333-8333-333333333333',
        leaseId: '44444444-4444-4444-8444-444444444444',
        runtimeProfileId: '55555555-5555-4555-8555-555555555555',
        runtimeProfileRevision: 1,
        policySnapshotHash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        executorFingerprint: 'bafkreiexecutor',
      },
      traceHeaders: { traceparent: '00-abc-def-01' },
    });
    await expect(src.claim()).resolves.toBeNull();
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(task.id, { projectId: null });
  });

  it('surfaces claim failures', async () => {
    const claimMock = vi
      .fn<TasksNamespace['claim']>()
      .mockRejectedValue(new Error('409 Conflict'));

    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    await expect(src.claim()).rejects.toThrow(/409 Conflict/);
  });

  it('keeps legacy claim responses compatible when authority is absent', async () => {
    const task = makeFulfillBriefTask({ status: 'dispatched' });
    const claimMock = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: { taskId: task.id, attemptN: 1 } as never,
      traceHeaders: {},
    });
    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: task.id,
    });

    await expect(src.claim()).resolves.toEqual({
      task,
      attemptN: 1,
      traceHeaders: {},
    });
  });

  it('forwards profileId when claiming a specific task', async () => {
    const task = makeFulfillBriefTask({ status: 'dispatched' });
    const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const claimMock = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: {
        taskId: task.id,
        attemptN: 1,
        claimedByAgentId: '33333333-3333-4333-8333-333333333333',
        runtimeId: null,
        leaseId: '44444444-4444-4444-8444-444444444444',
        runtimeProfileId: profileId,
        runtimeProfileRevision: 1,
        policySnapshotHash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        claimedAt: '2026-04-23T10:00:00Z',
        startedAt: null,
        completedAt: null,
        status: 'claimed',
        output: null,
        outputCid: null,
        error: null,
        usage: null,
        contentSignature: null,
        signedAt: null,
        claimedExecutorFingerprint: null,
        claimedExecutorManifest: null,
        completedExecutorFingerprint: null,
        completedExecutorManifest: null,
        daemonState: null,
      },
      traceHeaders: {},
    });

    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: task.id,
      profileId,
    });

    await expect(src.claim()).resolves.toMatchObject({ profileId });

    expect(claimMock).toHaveBeenCalledWith(task.id, {
      projectId: null,
      profileId,
    });
    await expect(src.claim()).resolves.toBeNull();
  });

  it('attaches a freshly signed executor manifest to the claim', async () => {
    const task = makeFulfillBriefTask({ status: 'dispatched' });
    const claimMock = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: { taskId: task.id, attemptN: 1 } as never,
      traceHeaders: {},
    });
    const attestation = {
      executorManifest: { schemaVersion: 'moltnet:executor-manifest:v1' },
      executorFingerprint: 'bafkreiexecutor',
      executorSignature: 'signature',
    };
    const createClaimAttestation = vi.fn().mockResolvedValue(attestation);
    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: task.id,
      profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createClaimAttestation,
    });

    const claimed = await src.claim();

    expect(createClaimAttestation).toHaveBeenCalledWith({
      taskId: task.id,
      profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(claimMock).toHaveBeenCalledWith(task.id, {
      projectId: null,
      profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ...attestation,
    });
    expect(claimed?.claimAuthority).toBeUndefined();
  });
});

it('declares the selected project for direct task claims', async () => {
  const task = makeFulfillBriefTask();
  const claim = vi.fn().mockResolvedValue({ task, attempt: { attemptN: 1 } });
  const source = new ApiTaskSource({
    agent: makeAgent(claim),
    taskId: task.id,
    projectId: 'project',
  } as never);
  await source.claim();
  expect(claim).toHaveBeenCalledWith(task.id, { projectId: 'project' });
});

function fixture() {
  const task = {
    id: 'task',
    teamId: 'team',
    projectId: null,
    status: 'running',
  };
  const attempt = {
    attemptN: 2,
    status: 'running',
    claimedByAgentId: 'agent',
    runtimeProfileId: 'profile',
    claimedExecutorFingerprint: 'executor',
    leaseId: 'lease',
    runtimeProfileRevision: 3,
    policySnapshotHash: 'hash',
  };
  const identity = { subjectType: 'agent', subjectId: 'agent' };
  const attempts = [attempt];
  const agent = {
    agents: { whoami: vi.fn(async () => identity) },
    tasks: {
      get: vi.fn(async () => task),
      listAttempts: vi.fn(async () => attempts),
      claim: vi.fn(),
    },
  };
  const source = new ApiTaskSource({
    agent: agent as unknown as Agent,
    taskId: 'task',
    resumeAttempt: 2,
    teamId: 'team',
    profileId: 'profile',
    executorFingerprint: 'executor',
    projectId: null,
  });
  return { task, attempt, identity, attempts, agent, source };
}
it('reattaches once with original authority without claiming a new attempt', async () => {
  const f = fixture();
  const resumed = await f.source.claim();
  expect(resumed?.claimAuthority).toEqual({
    claimantAgentId: 'agent',
    leaseId: 'lease',
    runtimeProfileId: 'profile',
    runtimeProfileRevision: 3,
    policySnapshotHash: 'hash',
    executorFingerprint: 'executor',
  });
  expect(await f.source.claim()).toBeNull();
  expect(f.agent.tasks.claim).not.toHaveBeenCalled();
});
it.each([
  'identity',
  'team',
  'profile',
  'executor',
  'lease',
  'finished',
  'superseded',
])('rejects changed %s', async (change) => {
  const f = fixture();
  if (change === 'identity') f.identity.subjectId = 'other';
  if (change === 'team') f.task.teamId = 'other';
  if (change === 'profile') f.attempt.runtimeProfileId = 'other';
  if (change === 'executor') f.attempt.claimedExecutorFingerprint = 'other';
  if (change === 'lease') f.attempt.leaseId = '';
  if (change === 'finished') f.task.status = 'completed';
  if (change === 'superseded') f.attempts.push({ ...f.attempt, attemptN: 3 });
  await expect(f.source.claim()).rejects.toThrow('Resume requires');
  expect(f.agent.tasks.claim).not.toHaveBeenCalled();
});

it('rejects incomplete resume authority without falling back to a fresh claim', async () => {
  const claim = vi.fn();
  const source = new ApiTaskSource({
    agent: makeAgent(claim),
    taskId: 'task',
    resumeAttempt: 1,
  });
  await expect(source.claim()).rejects.toThrow('Resume requires');
  expect(claim).not.toHaveBeenCalled();
});
