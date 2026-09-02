import { join } from 'node:path';

import { lock } from 'proper-lockfile';

export class ServeLockError extends Error {
  override name = 'ServeLockError';
  constructor(
    readonly code: 'held' | 'compromised' | 'failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ServeLock {
  path: string;
  release(): Promise<void>;
}

export interface AcquireServeLockOptions {
  /** Test-only timing overrides; production uses proper-lockfile defaults. */
  staleMs?: number;
  updateMs?: number;
  onCompromised?: (error: ServeLockError) => void;
}

/**
 * Acquire the per-root singleton lock. `proper-lockfile` uses an atomic lock
 * directory at exactly `<root>/serve.lock`, recovers stale owners, and keeps
 * the mtime fresh while the supervisor is alive.
 */
export async function acquireServeLock(
  root: string,
  options: AcquireServeLockOptions = {},
): Promise<ServeLock> {
  const path = join(root, 'serve.lock');
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await lock(root, {
      lockfilePath: path,
      realpath: false,
      retries: 0,
      ...(options.staleMs === undefined ? {} : { stale: options.staleMs }),
      ...(options.updateMs === undefined ? {} : { update: options.updateMs }),
      onCompromised: (cause) => {
        const error = new ServeLockError(
          'compromised',
          `serve lock ${path} was compromised: ${cause.message}`,
          { cause },
        );
        if (options.onCompromised) {
          options.onCompromised(error);
          return;
        }
        // Called from proper-lockfile's update timer. Throwing is deliberate:
        // continuing after ownership becomes uncertain could spawn two daemons.
        throw error;
      },
    });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ELOCKED') {
      throw new ServeLockError(
        'held',
        `another moltnet-agent serve process already owns ${path}`,
        { cause },
      );
    }
    throw new ServeLockError(
      'failed',
      `could not acquire serve lock ${path}: ${(cause as Error).message}`,
      { cause },
    );
  }

  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      await releaseLock();
    },
  };
}

/** Always release after normal completion or startup/runtime failure. */
export async function withServeLock<T>(
  root: string,
  work: () => Promise<T>,
  options?: AcquireServeLockOptions,
): Promise<T> {
  const held = await acquireServeLock(root, options);
  try {
    return await work();
  } finally {
    await held.release();
  }
}
