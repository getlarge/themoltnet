import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  agentKeyKey,
  assertCanonicalConfig,
  readConfig,
  updateTeamAgentKeyReference,
} from '@moltnet/agent-config';

import type { SecretReference } from './credentials.js';
import type { SecretProviderRegistry } from './secrets.js';

const RECOVERY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const MAX_RECORD_BYTES = 64 * 1024;

interface RecoveryRecord {
  version: 1;
  configDir: string;
  secretCaptured: boolean;
  secret?: string;
  reference?: SecretReference;
  subjectId?: string;
  teamId?: string;
  keyId?: string;
  retryContext?: {
    provisioning?: { operation?: string; teamId?: string };
    observedReference?: SecretReference;
    observedCredentialHash?: string | null;
  };
}

export interface EnrollmentRecoverySummary {
  recoveryId: string;
  secretCaptured: boolean;
  teamId?: string;
  keyId?: string;
  operation?: string;
  createdAt: string;
}

function recordPath(configDir: string, recoveryId: string): string {
  if (!RECOVERY_ID.test(recoveryId))
    throw new Error('Invalid enrollment recovery identifier');
  return join(configDir, 'credential-recovery', recoveryId);
}

async function readRecord(configDir: string, recoveryId: string) {
  const path = recordPath(configDir, recoveryId);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_RECORD_BYTES)
      throw new Error('Enrollment recovery record is invalid');
    const text = await file.readFile('utf8');
    const value: unknown = JSON.parse(text);
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('configDir' in value) ||
      typeof value.configDir !== 'string' ||
      resolve(value.configDir) !== resolve(configDir)
    )
      throw new Error(
        'Enrollment recovery record does not match this identity',
      );
    return {
      record: value as RecoveryRecord,
      createdAt: info.birthtime.toISOString(),
    };
  } finally {
    await file.close();
  }
}

/** Return only metadata; the captured one-time secret never leaves this process. */
export async function listEnrollmentRecoveries(
  configDir: string,
): Promise<EnrollmentRecoverySummary[]> {
  const dir = join(configDir, 'credential-recovery');
  const entries = await readdir(dir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const summaries = await Promise.all(
    entries
      .filter((name) => RECOVERY_ID.test(name))
      .map(async (recoveryId) => {
        const { record, createdAt } = await readRecord(configDir, recoveryId);
        return {
          recoveryId,
          secretCaptured: record.secretCaptured === true,
          ...(typeof record.teamId === 'string'
            ? { teamId: record.teamId }
            : typeof record.retryContext?.provisioning?.teamId === 'string'
              ? { teamId: record.retryContext.provisioning.teamId }
              : {}),
          ...(typeof record.keyId === 'string' ? { keyId: record.keyId } : {}),
          ...(typeof record.retryContext?.provisioning?.operation === 'string'
            ? { operation: record.retryContext.provisioning.operation }
            : {}),
          createdAt,
        };
      }),
  );
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Finish a captured enrollment on its original machine and verify before cleanup. */
export async function restoreCapturedEnrollment(options: {
  configDir: string;
  recoveryId: string;
  providers: SecretProviderRegistry;
  verify: (teamId: string) => Promise<void>;
}): Promise<{ teamId: string; keyId: string }> {
  const { configDir, recoveryId, providers, verify } = options;
  const { record } = await readRecord(configDir, recoveryId);
  const config = await readConfig(configDir);
  if (!config) throw new Error('Enrollment identity configuration is missing');
  assertCanonicalConfig(config);
  const { subjectId, teamId, keyId, reference, secret } = record;
  if (
    record.secretCaptured !== true ||
    !subjectId ||
    !teamId ||
    !keyId ||
    !reference ||
    typeof secret !== 'string' ||
    !secret.trim() ||
    config.subject_id !== subjectId ||
    reference.key !== agentKeyKey(subjectId, teamId) ||
    record.retryContext?.provisioning?.teamId !== teamId
  )
    throw new Error('Enrollment recovery record is incomplete or mismatched');
  const provider = providers.get(reference.provider);
  if (!provider?.capabilities.write || !provider.write)
    throw new Error('The original credential provider is not writable');

  const previous = record.retryContext?.observedReference;
  if (record.retryContext?.provisioning?.operation === 'renew') {
    if (
      !previous ||
      previous.provider !== reference.provider ||
      previous.key !== reference.key ||
      config.agent_key_refs?.[teamId]?.provider !== reference.provider ||
      config.agent_key_refs?.[teamId]?.key !== reference.key
    )
      throw new Error('The team credential changed after renewal');
    await updateTeamAgentKeyReference(
      subjectId,
      teamId,
      reference,
      configDir,
      async (current) => {
        if (
          current.agent_key_refs?.[teamId]?.provider !== reference.provider ||
          current.agent_key_refs?.[teamId]?.key !== reference.key
        )
          throw new Error('The team credential changed after renewal');
        const stored = await provider.read(reference.key);
        const oldHash = record.retryContext?.observedCredentialHash;
        if (
          stored !== secret &&
          (stored === null
            ? oldHash !== null
            : createHash('sha256').update(stored).digest('hex') !== oldHash)
        )
          throw new Error('The team credential changed after renewal');
        if (stored !== secret) {
          if (!provider.write)
            throw new Error('The original credential provider is not writable');
          await provider.write(reference.key, secret);
        }
        if ((await provider.read(reference.key)) !== secret)
          throw new Error('Recovered credential read-back failed');
      },
    );
  } else if (record.retryContext?.provisioning?.operation === 'enroll') {
    await updateTeamAgentKeyReference(
      subjectId,
      teamId,
      reference,
      configDir,
      async (current) => {
        const existing = current.agent_key_refs?.[teamId];
        if (existing) {
          if (
            existing.provider !== reference.provider ||
            existing.key !== reference.key ||
            (await provider.read(reference.key)) !== secret
          )
            throw new Error('The team credential changed after enrollment');
        } else {
          await providers.ensure(reference, secret);
        }
      },
    );
  } else {
    throw new Error('Enrollment recovery operation is invalid');
  }
  await verify(teamId);
  await rm(recordPath(configDir, recoveryId));
  return { teamId, keyId };
}
