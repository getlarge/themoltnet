import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretReference } from './credentials.js';
import { type SecretProvider, SecretProviderRegistry } from './secrets.js';

export const ENROLLMENT_RECOVERY_DIRECTORY = 'credential-recovery';
export const ENROLLMENT_RECOVERY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const activeRecoveryPaths = new Set<string>();

export function isEnrollmentRecoveryActive(path: string): boolean {
  return activeRecoveryPaths.has(path);
}

export interface EnrollmentRetryContext {
  subjectId: string;
  code?: string;
  idempotencyKey: string;
  expectedTeamId?: string;
  provisioning?: {
    teamId: string;
    operation: 'enroll' | 'renew';
    scopes: string[];
  };
  mode: 'human-pkce' | 'authenticated';
  observedReference?: SecretReference;
  observedCredentialHash?: string | null;
  apiUrl?: string;
}

/** Versioned on-disk state, shared by the capture and restore paths. */
export interface EnrollmentRecoveryRecord {
  version: 1;
  configDir: string;
  createdAt: string;
  retryContext?: EnrollmentRetryContext;
  secretCaptured: boolean;
  reference?: SecretReference;
  secret?: string;
  subjectId?: string;
  teamId?: string;
  keyId?: string;
}

/** Deliberately excludes provider error causes, which may contain secret values. */
export class CredentialPersistenceError extends Error {
  readonly code = 'CREDENTIAL_PERSISTENCE_FAILED';
  constructor(
    readonly recoveryPath?: string,
    readonly secretCaptured = false,
    readonly issuedKeyId?: string,
  ) {
    super(
      recoveryPath
        ? `Credential persistence failed; recovery material may be incomplete; inspect the protected file at ${recoveryPath}`
        : 'Credential persistence failed before recovery material could be saved',
    );
    this.name = 'CredentialPersistenceError';
  }
}

/** Reserve writable recovery storage before requesting a one-time credential. */
export async function prepareCredentialPersistence(
  configDir: string,
  retryContext?: EnrollmentRetryContext,
) {
  const recoveryDir = join(configDir, ENROLLMENT_RECOVERY_DIRECTORY);
  await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
  const path = join(recoveryDir, `${randomUUID()}.json`);
  const file = await open(path, 'wx', 0o600);
  activeRecoveryPaths.add(path);
  const createdAt = new Date().toISOString();
  // Persist request identity before issuance, so a process interruption retains
  // the exact retry context even when the one-time response never arrives.
  const writeRecord = async (record: EnrollmentRecoveryRecord) => {
    const data = Buffer.from(JSON.stringify(record) + '\n');
    let offset = 0;
    while (offset < data.length) {
      const { bytesWritten } = await file.write(
        data,
        offset,
        data.length - offset,
        offset,
      );
      if (!bytesWritten) throw new Error('Recovery write made no progress');
      offset += bytesWritten;
    }
    await file.truncate(data.length);
    await file.sync();
  };
  if (retryContext) {
    try {
      await writeRecord({
        version: 1,
        configDir,
        createdAt,
        retryContext,
        secretCaptured: false,
      });
    } catch {
      await file.close();
      activeRecoveryPaths.delete(path);
      throw new CredentialPersistenceError(path);
    }
  }
  let closed = false;
  let captured = false;
  let captureAttempted = false;
  let completed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await file.close();
    }
  };
  const capture = async (
    reference: SecretReference,
    secret: string,
    metadata: { subjectId: string; teamId?: string; keyId?: string },
  ) => {
    if (captured) return;
    try {
      captureAttempted = true;
      if (typeof secret !== 'string' || !secret.trim())
        throw new Error('No secret to capture');
      await writeRecord({
        version: 1,
        configDir,
        createdAt,
        retryContext,
        reference,
        secret,
        secretCaptured: true,
        ...metadata,
      });
      captured = true;
      await close();
    } catch {
      await close().catch(() => undefined);
      throw new CredentialPersistenceError(captureAttempted ? path : undefined);
    }
  };
  return {
    path,
    get recoveryPath() {
      return captureAttempted && !completed ? path : undefined;
    },
    capture,
    async retain() {
      try {
        await close();
        return path;
      } finally {
        activeRecoveryPaths.delete(path);
      }
    },
    async cancel() {
      try {
        await close();
        await rm(path, { force: true });
        completed = true;
      } finally {
        activeRecoveryPaths.delete(path);
      }
    },
    async persist(
      provider: SecretProvider,
      reference: SecretReference,
      secret: string,
      metadata: { subjectId: string; teamId?: string; keyId?: string },
      commit: (store: () => Promise<void>) => Promise<void>,
    ): Promise<void> {
      try {
        await capture(reference, secret, metadata);
        const registry = new SecretProviderRegistry().register(provider);
        await commit(async () => {
          await registry.ensure(reference, secret);
        });
        await rm(path);
        completed = true;
      } catch {
        await close().catch(() => undefined);
        throw new CredentialPersistenceError(
          captureAttempted ? path : undefined,
          captured,
          metadata.keyId,
        );
      } finally {
        activeRecoveryPaths.delete(path);
      }
    },
  };
}
