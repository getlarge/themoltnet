import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withProviderMutationLock } from './provider-lock.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'provider-lock-'));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

describe('provider locks', () => {
  it('aborts lock contention and permits a subsequent operation', async () => {
    const lockRoot = root();
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = withProviderMutationLock(lockRoot, async () => {
      markStarted();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    await started;
    const controller = new AbortController();
    const blocked = withProviderMutationLock(
      lockRoot,
      () => Promise.resolve('unreachable'),
      { signal: controller.signal },
    );
    controller.abort(new Error('cancelled'));

    await expect(blocked).rejects.toMatchObject({ code: 'lock_aborted' });
    releaseFirst();
    await first;
    await expect(
      withProviderMutationLock(lockRoot, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('times out with contention diagnostics', async () => {
    const lockRoot = root();
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = withProviderMutationLock(lockRoot, async () => {
      markStarted();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    await started;
    const logger = { warn: vi.fn() };

    await expect(
      withProviderMutationLock(lockRoot, () => Promise.resolve('unreachable'), {
        logger,
        timeoutMs: 1_050,
      }),
    ).rejects.toMatchObject({ code: 'lock_timeout' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'provider_lock_contended' }),
      'Provider operation is waiting for another process',
    );
    releaseFirst();
    await first;
  });
});
