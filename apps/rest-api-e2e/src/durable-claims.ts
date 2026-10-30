import { randomUUID } from 'node:crypto';

import {
  claimTask,
  type Client,
  createRuntimeProfile,
  createTask,
  registerExecutorManifest,
} from '@moltnet/api-client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Node E2E fixture setup.
import { buildE2EExecutorManifest } from '@moltnet/bootstrap/testing/durable';
import {
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import { expect } from 'vitest';

import type { TestAgent } from './helpers.js';

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

/** Claim lease for pinned attempts; the writer lease never outlives it. */
export const DEFAULT_LEASE_TTL_SEC = 120;

export interface PinnedClaim {
  taskId: string;
  attemptN: number;
  leaseId: string;
  executorFingerprint: string;
}

/**
 * Claims a task under a runtime profile with a registered executor. Only a
 * pinned claim carries the lease that Durable runtime stores authorize.
 */
export async function claimPinnedAttempt(
  client: Client,
  agent: TestAgent,
  label: string,
  {
    leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
    continueFrom,
    taskType = 'fulfill_brief',
  }: {
    leaseTtlSec?: number;
    taskType?: 'freeform' | 'fulfill_brief';
    continueFrom?: {
      taskId: string;
      attemptN: number;
      mode: 'fork' | 'extend';
    };
  } = {},
): Promise<PinnedClaim> {
  const headers = { 'x-moltnet-team-id': agent.personalTeamId };
  const created = await createRuntimeProfile({
    client,
    auth: () => agent.accessToken,
    headers,
    body: {
      name: `${label}-${randomUUID()}`,
      models: {
        generation: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      },
      sandbox: {
        hostExec: { autoApprove: false },
        resources: { cpus: 2, memory: '2G' },
      },
    },
  });
  expect(created.error).toBeUndefined();
  const profile = required(created.data, 'runtime profile');

  const createdTask = await createTask({
    client,
    auth: () => agent.accessToken,
    headers,
    body: {
      taskType: continueFrom ? 'freeform' : taskType,
      title: label,
      diaryId: agent.privateDiaryId,
      allowedProfiles: [{ profileId: profile.id }],
      input: { brief: label, ...(continueFrom ? { continueFrom } : {}) },
    },
  });
  expect(createdTask.error).toBeUndefined();
  const task = required(createdTask.data, 'task');

  const manifest = buildE2EExecutorManifest(profile, label);
  const executorFingerprint = computeExecutorManifestCid(manifest);
  const registration = await registerExecutorManifest({
    client,
    auth: () => agent.accessToken,
    body: {
      executorManifest: manifest,
      executorFingerprint,
      executorSignature: await signExecutorAttestation(
        buildExecutorRegistrationAttestationPayload({ executorFingerprint }),
        agent.keyPair.privateKey,
      ),
    },
  });
  expect(registration.error).toBeUndefined();

  const claim = await claimTask({
    client,
    auth: () => agent.accessToken,
    headers,
    path: { id: task.id },
    body: { leaseTtlSec, profileId: profile.id, executorFingerprint },
  });
  expect(claim.error).toBeUndefined();
  const { attemptN, leaseId } = required(claim.data, 'claim').attempt;
  return {
    taskId: task.id,
    attemptN,
    leaseId: required(leaseId, 'claim lease'),
    executorFingerprint,
  };
}
