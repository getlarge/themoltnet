import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretReference } from './credentials.js';
import { type SecretProvider, SecretProviderRegistry } from './secrets.js';

/** Deliberately excludes provider error causes, which may contain secret values. */
export class CredentialPersistenceError extends Error {
  readonly code = 'CREDENTIAL_PERSISTENCE_FAILED';
  constructor(readonly recoveryPath?: string) {
    super(
      recoveryPath
        ? `Credential persistence failed; recovery material may be incomplete; inspect the protected file at ${recoveryPath}`
        : 'Credential persistence failed before recovery material could be saved',
    );
    this.name = 'CredentialPersistenceError';
  }
}

/** Reserve writable recovery storage before requesting a one-time credential. */
export async function prepareCredentialPersistence(configDir: string) {
  const recoveryDir = join(configDir, 'credential-recovery');
  await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
  const path = join(recoveryDir, `${randomUUID()}.json`);
  const file = await open(path, 'wx', 0o600);
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
      await file.writeFile(
        JSON.stringify({
          version: 1,
          configDir,
          reference,
          secret,
          ...metadata,
        }) + '\n',
      );
      await file.sync();
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
        );
      }
    },
  };
}
