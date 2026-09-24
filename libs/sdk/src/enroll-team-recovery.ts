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

import {
  ENROLLMENT_RECOVERY_DIRECTORY,
  ENROLLMENT_RECOVERY_ID,
  type EnrollmentRecoveryRecord,
  isEnrollmentRecoveryActive,
} from './credential-persistence.js';
import type { SecretProviderRegistry } from './secrets.js';

const MAX_RECORD_BYTES = 64 * 1024;

/** Safe, stable reason for a restore that kept its recovery record. */
export class EnrollmentRestoreError extends Error {
  override name = 'EnrollmentRestoreError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
  if (!ENROLLMENT_RECOVERY_ID.test(recoveryId))
    throw new EnrollmentRestoreError(
      'record_invalid',
      'Invalid recovery identifier',
    );
  return join(configDir, ENROLLMENT_RECOVERY_DIRECTORY, recoveryId);
}

async function readRecord(configDir: string, recoveryId: string) {
  const path = recordPath(configDir, recoveryId);
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new EnrollmentRestoreError(
        'recovery_not_found',
        'Recovery record not found',
      );
    throw error;
  });
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_RECORD_BYTES)
      throw new EnrollmentRestoreError(
        'record_invalid',
        'Enrollment recovery record is invalid',
      );
    const text = await file.readFile('utf8');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new EnrollmentRestoreError(
        'record_invalid',
        'Enrollment recovery record is invalid',
      );
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('configDir' in value) ||
      typeof value.configDir !== 'string' ||
      resolve(value.configDir) !== resolve(configDir)
    )
      throw new EnrollmentRestoreError(
        'record_invalid',
        'Enrollment recovery record does not match this identity',
      );
    return {
      record: value as EnrollmentRecoveryRecord,
      createdAt:
        typeof (value as EnrollmentRecoveryRecord).createdAt === 'string'
          ? (value as EnrollmentRecoveryRecord).createdAt
          : info.birthtimeMs > 0
            ? info.birthtime.toISOString()
            : info.mtime.toISOString(),
    };
  } finally {
    await file.close();
  }
}

/** Return only metadata; the captured one-time secret never leaves this process. */
export async function listEnrollmentRecoveries(
  configDir: string,
): Promise<EnrollmentRecoverySummary[]> {
  const dir = join(configDir, ENROLLMENT_RECOVERY_DIRECTORY);
  const entries = await readdir(dir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const results = await Promise.allSettled(
    entries
      .filter((name) => ENROLLMENT_RECOVERY_ID.test(name))
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
  return results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Discard only the record the native operator inspected and confirmed. */
export async function discardEnrollmentRecovery(options: {
  configDir: string;
  recoveryId: string;
  expectedSecretCaptured: boolean;
}): Promise<void> {
  const { configDir, recoveryId, expectedSecretCaptured } = options;
  if (isEnrollmentRecoveryActive(recordPath(configDir, recoveryId)))
    throw new EnrollmentRestoreError(
      'recovery_in_progress',
      'Enrollment is still using this recovery record',
    );
  const { record } = await readRecord(configDir, recoveryId);
  if (record.secretCaptured !== expectedSecretCaptured)
    throw new EnrollmentRestoreError(
      'recovery_state_changed',
      'Recovery record changed; refresh it before discarding',
    );
  if (isEnrollmentRecoveryActive(recordPath(configDir, recoveryId)))
    throw new EnrollmentRestoreError(
      'recovery_in_progress',
      'Enrollment is still using this recovery record',
    );
  await rm(recordPath(configDir, recoveryId), { force: true });
}

/** Finish a captured enrollment on its original machine and verify before cleanup. */
export async function restoreCapturedEnrollment(options: {
  configDir: string;
  recoveryId: string;
  providers: SecretProviderRegistry;
  verify: (teamId: string, secret: string) => Promise<{ keyId: string }>;
}): Promise<{ teamId: string; keyId: string }> {
  const { configDir, recoveryId, providers, verify } = options;
  const { record } = await readRecord(configDir, recoveryId);
  const config = await readConfig(configDir).catch(() => {
    throw new EnrollmentRestoreError(
      'identity_unavailable',
      'Enrollment identity configuration could not be read',
    );
  });
  if (!config)
    throw new EnrollmentRestoreError(
      'identity_missing',
      'Enrollment identity configuration is missing',
    );
  try {
    assertCanonicalConfig(config);
  } catch {
    throw new EnrollmentRestoreError(
      'identity_invalid',
      'Enrollment identity configuration is invalid',
    );
  }
  const { subjectId, teamId, keyId, reference, secret } = record;
  if (
    record.secretCaptured !== true ||
    typeof secret !== 'string' ||
    !secret.trim()
  )
    throw new EnrollmentRestoreError(
      'secret_not_captured',
      'Recovery record has no captured credential',
    );
  if (!subjectId || config.subject_id !== subjectId)
    throw new EnrollmentRestoreError(
      'identity_mismatch',
      'Recovery record identity does not match',
    );
  if (!teamId || record.retryContext?.provisioning?.teamId !== teamId)
    throw new EnrollmentRestoreError(
      'team_mismatch',
      'Recovery record team does not match',
    );
  if (!keyId || !reference || reference.key !== agentKeyKey(subjectId, teamId))
    throw new EnrollmentRestoreError(
      'reference_invalid',
      'Recovery record key reference is invalid',
    );
  const provider = providers.get(reference.provider);
  if (!provider?.capabilities.write || !provider.write)
    throw new EnrollmentRestoreError(
      'provider_unwritable',
      'The original credential provider is not writable',
    );

  // A candidate must authenticate with the exact identity, team, key ID, and
  // daemon minimum scopes before touching a live slot. This also rejects a
  // captured response that failed the normal enrollment commit guard.
  const verified = await verify(teamId, secret).catch((error: unknown) => {
    if (error instanceof EnrollmentRestoreError) throw error;
    throw new EnrollmentRestoreError(
      'verification_unavailable',
      'Credential verification is unavailable; retry when the service is reachable',
    );
  });
  if (verified.keyId !== keyId)
    throw new EnrollmentRestoreError(
      'key_id_mismatch',
      'Captured credential key ID does not match verification',
    );

  const previous = record.retryContext?.observedReference;
  try {
    if (record.retryContext?.provisioning?.operation === 'renew') {
      if (
        !previous ||
        previous.provider !== reference.provider ||
        previous.key !== reference.key ||
        config.agent_key_refs?.[teamId]?.provider !== reference.provider ||
        config.agent_key_refs?.[teamId]?.key !== reference.key
      )
        throw new EnrollmentRestoreError(
          'credential_changed',
          'The team credential changed after renewal',
        );
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
            throw new EnrollmentRestoreError(
              'credential_changed',
              'The team credential changed after renewal',
            );
          const stored = await provider.read(reference.key);
          const oldHash = record.retryContext?.observedCredentialHash;
          if (
            stored !== secret &&
            (stored === null
              ? oldHash !== null
              : createHash('sha256').update(stored).digest('hex') !== oldHash)
          )
            throw new EnrollmentRestoreError(
              'credential_changed',
              'The team credential changed after renewal',
            );
          if (stored !== secret) {
            if (!provider.write)
              throw new EnrollmentRestoreError(
                'provider_unwritable',
                'The original credential provider is not writable',
              );
            await provider.write(reference.key, secret);
          }
          if ((await provider.read(reference.key)) !== secret)
            throw new EnrollmentRestoreError(
              'readback_failed',
              'Recovered credential read-back failed',
            );
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
              throw new EnrollmentRestoreError(
                'credential_changed',
                'The team credential changed after enrollment',
              );
          } else {
            await providers.ensure(reference, secret);
          }
        },
      );
    } else {
      throw new EnrollmentRestoreError(
        'operation_invalid',
        'Enrollment recovery operation is invalid',
      );
    }
  } catch (error) {
    if (error instanceof EnrollmentRestoreError) throw error;
    throw new EnrollmentRestoreError(
      'restore_unavailable',
      'The identity or credential provider could not be updated; retry after checking the local server logs',
    );
  }
  await rm(recordPath(configDir, recoveryId), { force: true });
  return { teamId, keyId };
}
