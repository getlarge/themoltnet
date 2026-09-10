import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { lock } from 'proper-lockfile';

/**
 * Serialize provider state shared by the CLI and the long-running Agent Server.
 * The lock target is a stable directory because the protected JSON files may
 * not exist yet.
 */
export async function withProviderMutationLock<T>(
  root: string,
  work: () => Promise<T>,
): Promise<T> {
  return withNamedProviderLock(root, 'providers', work);
}

/** Serialize Pi credential operations for one provider across processes. */
export async function withProviderOAuthLock<T>(
  root: string,
  providerId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withNamedProviderLock(
    root,
    `oauth-${encodeURIComponent(providerId)}`,
    work,
  );
}

async function withNamedProviderLock<T>(
  root: string,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const locksDir = join(root, 'locks');
  mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  const release = await lock(locksDir, {
    lockfilePath: join(locksDir, `${name}.lock`),
    realpath: false,
    retries: {
      forever: true,
      factor: 1.2,
      minTimeout: 25,
      maxTimeout: 1_000,
      randomize: true,
    },
  });
  try {
    return await work();
  } finally {
    await release();
  }
}
