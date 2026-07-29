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
const PROFILE_DEFINITION_CID = 'bafkreiprofiledefinition';
const LEASE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EXECUTOR_FINGERPRINT = 'bafkreiexecutor';
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
    status: 'running',
    claimedByAgentId: AGENT_ID,
    leaseId: LEASE_ID,
    runtimeProfileId: PROFILE_ID,
    runtimeProfileRevision: 7,
    policySnapshotHash: SNAPSHOT_HASH,
    claimedExecutorFingerprint: EXECUTOR_FINGERPRINT,
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
  executor?: { fingerprint: string; manifest: unknown } | null;
}) {
  const taskRepository = {
    findById: vi
      .fn()
      .mockResolvedValue(input && 'task' in input ? input.task : task()),
    findAttempt: vi
      .fn()
      .mockResolvedValue(
        input && 'attempt' in input ? input.attempt : attempt(),
      ),
    findExecutorManifest: vi.fn().mockResolvedValue(
      input && 'executor' in input
        ? input.executor
        : {
            fingerprint: EXECUTOR_FINGERPRINT,
            manifest: {
              profile: {
                id: PROFILE_ID,
                definitionCid: PROFILE_DEFINITION_CID,
              },
              runtime: { kind: 'gondolin_pi' },
            },
          },
    ),
  };
  const snapshotRepository = {
    findByHash: vi
      .fn()
      .mockResolvedValue(
        input && 'snapshot' in input ? input.snapshot : snapshot(),
      ),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const denialCounter = { add: vi.fn() };
  const provider = createMoltNetTaskAuthorityProvider({
    taskRepository: taskRepository as unknown as Pick<
      TaskRepository,
      'findById' | 'findAttempt' | 'findExecutorManifest'
    >,
    runtimePolicySnapshotRepository:
      snapshotRepository as unknown as RuntimePolicySnapshotRepository,
    logger,
    denialCounter,
    now: () => NOW,
  });
  return {
    provider,
    taskRepository,
    snapshotRepository,
    logger,
    denialCounter,
  };
}

const request = {
  agentId: AGENT_ID,
  teamId: TEAM_ID,
  taskId: TASK_ID,
  attemptN: 1,
};

async function expectDenied(
  context: ReturnType<typeof setup>,
  reason: string,
  authorityRequest = request,
  logLevel: 'info' | 'warn' = 'warn',
) {
  await expect(
    context.provider.authorizeTask(authorityRequest),
  ).resolves.toEqual({
    allowed: false,
    reason,
  });
  expect(context.logger[logLevel]).toHaveBeenCalledWith(
    {
      reason,
      taskId: authorityRequest.taskId,
      attemptN: authorityRequest.attemptN,
      agentId: authorityRequest.agentId,
      teamId: authorityRequest.teamId,
    },
    'Task authority denied',
  );
  const otherLogLevel = logLevel === 'info' ? 'warn' : 'info';
  expect(context.logger[otherLogLevel]).not.toHaveBeenCalled();
  expect(context.denialCounter.add).toHaveBeenCalledWith(1, { reason });
}

describe('MoltNet TaskAuthorityProvider', () => {
  it('returns only canonical claims from the immutable attempt binding', async () => {
    const { provider, logger, denialCounter } = setup();

    await expect(provider.authorizeTask(request)).resolves.toEqual({
      allowed: true,
      reason: 'active_pinned_authority',
      leaseExpiresAt: new Date('2026-07-28T12:05:00Z'),
      claims: {
        ...request,
        leaseId: LEASE_ID,
        runtimeKind: 'gondolin_pi',
        executorManifestFingerprint: EXECUTOR_FINGERPRINT,
        runtimeProfileId: PROFILE_ID,
        runtimeProfileRevision: 7,
        policySnapshotHash: SNAPSHOT_HASH,
      },
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(denialCounter.add).not.toHaveBeenCalled();
  });

  it('denies missing tasks and attempts', async () => {
    await expectDenied(
      setup({ task: null }),
      'task_attempt_not_found',
      request,
    );
    await expectDenied(
      setup({ attempt: null }),
      'task_attempt_not_found',
      request,
    );
  });

  it('denies mismatched team and claimant bindings', async () => {
    await expectDenied(setup(), 'team_mismatch', {
      ...request,
      teamId: OTHER_TEAM_ID,
    });
    await expectDenied(
      setup({ attempt: attempt({ claimedByAgentId: OTHER_AGENT_ID }) }),
      'claimant_mismatch',
    );
    await expectDenied(
      setup({ task: task({ claimAgentId: OTHER_AGENT_ID }) }),
      'claimant_mismatch',
    );
  });

  it.each([
    'completed',
    'failed',
    'cancelled',
    'aborted',
    'timed_out',
  ] as const)(
    'denies a %s attempt even while its task lease is active',
    async (status) => {
      await expectDenied(
        setup({ attempt: attempt({ status }) }),
        'attempt_inactive',
        request,
        'info',
      );
    },
  );

  it.each([
    task({ status: 'queued' }),
    task({ claimExpiresAt: null }),
    task({ claimExpiresAt: new Date('2026-07-28T11:59:59Z') }),
  ])('denies an inactive task lease', async (inactiveTask) => {
    await expectDenied(
      setup({ task: inactiveTask }),
      'lease_inactive',
      request,
      'info',
    );
  });

  it.each([
    { leaseId: null },
    { runtimeProfileId: null },
    { runtimeProfileRevision: null },
    { policySnapshotHash: null },
    { claimedExecutorFingerprint: null },
  ])('denies an incomplete pinned authority: %o', async (missingBinding) => {
    await expectDenied(
      setup({ attempt: attempt(missingBinding) }),
      'authority_binding_missing',
    );
  });

  it('denies a missing immutable snapshot', async () => {
    await expectDenied(setup({ snapshot: null }), 'policy_snapshot_missing');
  });

  it('denies a missing pinned executor manifest', async () => {
    await expectDenied(setup({ executor: null }), 'executor_manifest_missing');
  });

  it('denies an unsupported snapshot schema version', async () => {
    await expectDenied(
      setup({ snapshot: snapshot({ schemaVersion: 'v999' }) }),
      'schema_version_mismatch',
    );
  });

  it('denies invalid snapshot authority', async () => {
    await expectDenied(
      setup({
        snapshot: snapshot({ enforcement: 'unknown_enforcement' }),
      }),
      'authority_binding_invalid',
    );
  });

  it('denies a snapshot that does not match the pinned executor runtime', async () => {
    await expectDenied(
      setup({
        executor: {
          fingerprint: EXECUTOR_FINGERPRINT,
          manifest: {
            profile: {
              id: PROFILE_ID,
              definitionCid: PROFILE_DEFINITION_CID,
            },
            runtime: { kind: 'custom_pi' },
          },
        },
      }),
      'executor_binding_mismatch',
    );
  });

  it('denies an executor manifest without an immutable profile definition binding', async () => {
    await expectDenied(
      setup({
        executor: {
          fingerprint: EXECUTOR_FINGERPRINT,
          manifest: {
            profile: { id: PROFILE_ID },
            runtime: { kind: 'gondolin_pi' },
          },
        },
      }),
      'executor_binding_mismatch',
    );
  });

  it('denies a structurally invalid executor manifest', async () => {
    await expectDenied(
      setup({
        executor: {
          fingerprint: EXECUTOR_FINGERPRINT,
          manifest: [],
        },
      }),
      'executor_binding_mismatch',
    );
  });

  it('denies snapshot content inconsistent with its content hash', async () => {
    await expectDenied(
      setup({ snapshot: snapshot({ allowedTools: ['write'] }) }),
      'snapshot_hash_mismatch',
    );
  });

  it('denies a self-consistent snapshot that differs from the attempt pin', async () => {
    const otherCanonical = canonicalEffectivePolicySnapshot({
      runtimeKind: 'gondolin_pi',
      enforcement: 'watch',
      allowedTools: ['read'],
    });
    const otherHash = hashEffectivePolicySnapshot(otherCanonical);

    await expectDenied(
      setup({
        snapshot: snapshot({
          hash: otherHash,
          schemaVersion: otherCanonical.version,
          runtimeKind: otherCanonical.runtimeKind,
          enforcement: otherCanonical.enforcement,
          allowedTools: otherCanonical.allowedTools,
        }),
      }),
      'snapshot_hash_mismatch',
    );
  });
});
