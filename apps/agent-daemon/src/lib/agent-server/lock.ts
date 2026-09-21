import { join } from 'node:path';

import { lock } from 'proper-lockfile';

import { readAgentServerEndpoint } from './endpoint.js';

export class AgentServerLockError extends Error {
  override name = 'AgentServerLockError';
  constructor(
    readonly code: 'held' | 'compromised' | 'failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AgentServerLock {
  path: string;
  release(): Promise<void>;
}

export interface AcquireAgentServerLockOptions {
  /** Test-only timing overrides; production uses proper-lockfile defaults. */
  staleMs?: number;
  updateMs?: number;
  onCompromised?: (error: AgentServerLockError) => void;
}

/**
 * Acquire the per-root singleton lock. `proper-lockfile` uses an atomic lock
 * directory at exactly `<root>/agent-server.lock`, recovers stale owners, and keeps
 * the mtime fresh while the supervisor is alive.
 */
export async function acquireAgentServerLock(
  root: string,
  options: AcquireAgentServerLockOptions = {},
): Promise<AgentServerLock> {
  const path = join(root, 'agent-server.lock');
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await lock(root, {
      lockfilePath: path,
      realpath: false,
      retries: 0,
      ...(options.staleMs === undefined ? {} : { stale: options.staleMs }),
      ...(options.updateMs === undefined ? {} : { update: options.updateMs }),
      onCompromised: (cause) => {
        const error = new AgentServerLockError(
          'compromised',
          `Agent Server lock ${path} was compromised: ${cause.message}`,
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
      let holder = '';
      try {
        const endpoint = readAgentServerEndpoint(root);
        if (endpoint?.pid)
          holder = ` (PID ${endpoint.pid}, instance ${endpoint.instanceId})`;
      } catch {
        /* Discovery is diagnostic only; lock ownership remains authoritative. */
      }
      throw new AgentServerLockError(
        'held',
        `another moltnet-agent server process already owns ${path}${holder}; stop that process before retrying`,
        { cause },
      );
    }
    throw new AgentServerLockError(
      'failed',
      `could not acquire Agent Server lock ${path}: ${(cause as Error).message}`,
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
export async function withAgentServerLock<T>(
  root: string,
  work: () => Promise<T>,
  options?: AcquireAgentServerLockOptions & { stateRoot?: string },
): Promise<T> {
  const held: AgentServerLock[] = [];
  try {
    held.push(await acquireAgentServerLock(root, options));
    // Also participate in the connection-state lock used by running releases.
    if (options?.stateRoot && options.stateRoot !== root) {
      held.push(await acquireAgentServerLock(options.stateRoot, options));
    }
    return await work();
  } finally {
    for (const entry of held.reverse()) {
      await entry.release().catch((error: unknown) => {
        console.error(
          `Could not release Agent Server lock ${entry.path}: ${String(error)}`,
        );
      });
    }
  }
}
