import type { Agent } from '@themoltnet/sdk';
import { expect, it, vi } from 'vitest';

import { ResumeApiTaskSource } from './resume-api.js';

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
  const source = new ResumeApiTaskSource({
    agent: agent as unknown as Agent,
    taskId: 'task',
    attemptN: 2,
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
