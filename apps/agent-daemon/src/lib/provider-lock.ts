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
  let compromised: Error | undefined;
  const release = await lock(locksDir, {
    lockfilePath: join(locksDir, `${name}.lock`),
    // Agent Server may be shut down while an upstream OAuth flow is still
    // unwinding. Do not let proper-lockfile's background update throw an
    // uncaught exception if the daemon root is removed during that window;
    // surface the compromise through the operation promise instead.
    onCompromised: (error) => {
      compromised = error;
    },
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
    const result = await work();
    if (compromised) throw compromised;
    return result;
  } finally {
    try {
      await release();
    } catch (error) {
      if (!compromised) throw error;
    }
  }
}
