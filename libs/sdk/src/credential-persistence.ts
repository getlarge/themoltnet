import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretReference } from './credentials.js';
import { type SecretProvider, SecretProviderRegistry } from './secrets.js';

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
  retryContext?: Record<string, unknown>,
) {
  const recoveryDir = join(configDir, 'credential-recovery');
  await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
  const path = join(recoveryDir, `${randomUUID()}.json`);
  const file = await open(path, 'wx', 0o600);
  // Persist request identity before issuance, so a process interruption retains
  // the exact retry context even when the one-time response never arrives.
  const writeRecord = async (record: object) => {
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
        retryContext,
        secretCaptured: false,
      });
    } catch {
      await file.close();
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
      await close();
      return path;
    },
    async cancel() {
      await close();
      await rm(path, { force: true });
      completed = true;
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
      }
    },
  };
}
