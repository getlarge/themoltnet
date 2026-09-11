import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { lock } from 'proper-lockfile';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const LOCK_WAIT_WARNING_MS = 1_000;

export interface ProviderLockLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface ProviderLockOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  logger?: ProviderLockLogger;
}

export class ProviderLockError extends Error {
  override name = 'ProviderLockError';

  constructor(
    readonly code: 'lock_aborted' | 'lock_timeout',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Serialize provider state shared by the CLI and the long-running Agent Server.
 * The lock target is a stable directory because the protected JSON files may
 * not exist yet.
 */
export async function withProviderMutationLock<T>(
  root: string,
  work: () => Promise<T>,
  options: ProviderLockOptions = {},
): Promise<T> {
  return withNamedProviderLock(root, 'providers', work, options);
}

/** Serialize Pi credential operations for one provider across processes. */
export async function withProviderOAuthLock<T>(
  root: string,
  providerId: string,
  work: () => Promise<T>,
  options: ProviderLockOptions = {},
): Promise<T> {
  return withNamedProviderLock(
    root,
    `oauth-${encodeURIComponent(providerId)}`,
    work,
    options,
  );
}

async function withNamedProviderLock<T>(
  root: string,
  name: string,
  work: () => Promise<T>,
  options: ProviderLockOptions,
): Promise<T> {
  const locksDir = join(root, 'locks');
  mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  let compromised: Error | undefined;
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const lockfilePath = join(locksDir, `${name}.lock`);
  let warned = false;
  let release: Awaited<ReturnType<typeof lock>>;
  for (;;) {
    if (options.signal?.aborted) {
      throw new ProviderLockError(
        'lock_aborted',
        `provider lock acquisition was cancelled for "${name}"`,
        { cause: options.signal.reason },
      );
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new ProviderLockError(
        'lock_timeout',
        `timed out waiting for provider lock "${name}"`,
      );
    }
    if (!warned && elapsedMs >= LOCK_WAIT_WARNING_MS) {
      warned = true;
      options.logger?.warn(
        { code: 'provider_lock_contended', elapsedMs, lockName: name },
        'Provider operation is waiting for another process',
      );
    }
    try {
      release = await lock(locksDir, {
        lockfilePath,
        // Agent Server may be shut down while an upstream OAuth flow is still
        // unwinding. Do not let proper-lockfile's background update throw an
        // uncaught exception if the daemon root is removed during that window;
        // surface the compromise through the operation promise instead.
        onCompromised: (error) => {
          compromised = error;
        },
        realpath: false,
        retries: 0,
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error;
      const remainingMs = timeoutMs - elapsedMs;
      try {
        await delay(Math.min(100, remainingMs), undefined, {
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (cause) {
        throw new ProviderLockError(
          'lock_aborted',
          `provider lock acquisition was cancelled for "${name}"`,
          { cause },
        );
      }
    }
  }
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await work() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await release();
  } catch (error) {
    if (!compromised && outcome.ok) outcome = { ok: false, error };
  }
  if (!outcome.ok) throw outcome.error;
  if (compromised) throw compromised;
  return outcome.value;
}
