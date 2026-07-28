import type {
  RuntimePolicySnapshot,
  RuntimePolicySnapshotRepository,
  Task,
  TaskAttempt,
  TaskRepository,
} from '@moltnet/database';
import {
  canonicalEffectivePolicySnapshot,
  hashEffectivePolicySnapshot,
} from '@moltnet/runtime-policy-service';
import { describe, expect, it, vi } from 'vitest';

import { createMoltNetTaskAuthorityProvider } from './task-authority-provider.js';

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROFILE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEASE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NOW = new Date('2026-07-28T12:00:00Z');

const canonicalSnapshot = canonicalEffectivePolicySnapshot({
  runtimeKind: 'gondolin_pi',
  enforcement: 'enforce',
  allowedTools: ['git', 'read'],
});
const SNAPSHOT_HASH = hashEffectivePolicySnapshot(canonicalSnapshot);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    teamId: TEAM_ID,
    status: 'running',
    claimAgentId: AGENT_ID,
    claimExpiresAt: new Date('2026-07-28T12:05:00Z'),
    ...overrides,
  } as Task;
}

function attempt(overrides: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    taskId: TASK_ID,
    attemptN: 1,
    claimedByAgentId: AGENT_ID,
    leaseId: LEASE_ID,
    runtimeProfileId: PROFILE_ID,
    runtimeProfileRevision: 7,
    policySnapshotHash: SNAPSHOT_HASH,
    ...overrides,
  } as TaskAttempt;
}

function snapshot(
  overrides: Partial<RuntimePolicySnapshot> = {},
): RuntimePolicySnapshot {
  return {
    hash: SNAPSHOT_HASH,
    schemaVersion: canonicalSnapshot.version,
    runtimeKind: canonicalSnapshot.runtimeKind,
    capabilityManifestVersion: canonicalSnapshot.capabilityManifestVersion,
    enforcement: canonicalSnapshot.enforcement,
    allowedTools: canonicalSnapshot.allowedTools,
    createdAt: NOW,
    ...overrides,
  };
}

function setup(input?: {
  task?: Task | null;
  attempt?: TaskAttempt | null;
  snapshot?: RuntimePolicySnapshot | null;
}) {
  const taskRepository = {
    findById: vi.fn().mockResolvedValue(input?.task ?? task()),
    findAttempt: vi.fn().mockResolvedValue(input?.attempt ?? attempt()),
  };
  const snapshotRepository = {
    findByHash: vi.fn().mockResolvedValue(input?.snapshot ?? snapshot()),
  };
  const provider = createMoltNetTaskAuthorityProvider({
    taskRepository: taskRepository as unknown as Pick<
      TaskRepository,
      'findById' | 'findAttempt'
    >,
    runtimePolicySnapshotRepository:
      snapshotRepository as unknown as RuntimePolicySnapshotRepository,
    now: () => NOW,
  });
  return { provider, taskRepository, snapshotRepository };
}

const request = {
  agentId: AGENT_ID,
  teamId: TEAM_ID,
  taskId: TASK_ID,
  attemptN: 1,
};

describe('MoltNet TaskAuthorityProvider', () => {
  it('returns only canonical claims from the immutable attempt binding', async () => {
    const { provider } = setup();

    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: true,
      reason: 'active_pinned_authority',
      leaseExpiresAt: new Date('2026-07-28T12:05:00Z'),
      claims: {
        ...request,
        leaseId: LEASE_ID,
        runtimeKind: 'gondolin_pi',
        capabilityManifestVersion: 'gondolin_pi:v1',
        runtimeProfileId: PROFILE_ID,
        runtimeProfileRevision: 7,
        policySnapshotHash: SNAPSHOT_HASH,
      },
    });
  });

  it.each([
    ['team_mismatch', { ...request, teamId: OTHER_TEAM_ID }],
    ['claimant_mismatch', { ...request, agentId: OTHER_AGENT_ID }],
    ['task_attempt_not_found', { ...request, attemptN: 2 }],
  ])('denies %s requests', async (reason, mismatchedRequest) => {
    const { provider, taskRepository } = setup();
    if (reason === 'task_attempt_not_found') {
      taskRepository.findAttempt.mockResolvedValue(null);
    }
    await expect(provider.authorizeTask(mismatchedRequest)).resolves.toEqual({
      allowed: false,
      reason,
    });
  });

  it('denies an inactive or expired lease', async () => {
    const { provider } = setup({
      task: task({ claimExpiresAt: new Date('2026-07-28T11:59:59Z') }),
    });
    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: false,
      reason: 'lease_inactive',
    });
  });

  it('denies legacy attempts without a complete pinned authority', async () => {
    const { provider } = setup({
      attempt: attempt({ policySnapshotHash: null }),
    });
    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: false,
      reason: 'authority_binding_missing',
    });
  });

  it('denies a missing immutable snapshot', async () => {
    const { provider, snapshotRepository } = setup();
    snapshotRepository.findByHash.mockResolvedValue(null);
    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: false,
      reason: 'policy_snapshot_missing',
    });
  });

  it('denies snapshot content inconsistent with its pinned hash', async () => {
    const { provider } = setup({
      snapshot: snapshot({ allowedTools: ['write'] }),
    });
    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: false,
      reason: 'authority_binding_inconsistent',
    });
  });
});
