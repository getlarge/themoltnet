import { describe, expect, it, vi } from 'vitest';

import { discoverGuestExecutables } from './capability-discovery.js';

describe('discoverGuestExecutables', () => {
  it('uses one bounded guest probe and maps indexes to unique candidates', async () => {
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '0\n2\n',
      stderr: '',
    });

    await expect(
      discoverGuestExecutables({ exec } as never, [
        'git',
        'missing',
        'git',
        'moltnet',
      ]),
    ).resolves.toEqual({
      available: ['git', 'moltnet'],
      unavailable: ['missing'],
    });
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toEqual([
      '/bin/sh',
      '-lc',
      expect.stringContaining('command -v "$executable"'),
      'moltnet-capability-probe',
      'git',
      'missing',
      'moltnet',
    ]);
  });

  it('skips the guest round trip when no executable is relevant', async () => {
    const exec = vi.fn();

    await expect(
      discoverGuestExecutables({ exec } as never, []),
    ).resolves.toEqual({ available: [], unavailable: [] });
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails closed when the trusted probe fails', async () => {
    const exec = vi.fn().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'probe failed',
    });

    await expect(
      discoverGuestExecutables({ exec } as never, ['git']),
    ).rejects.toThrow('capability probe failed (exit 127): probe failed');
  });

  it('bounds a hung guest probe', async () => {
    const exec = vi.fn(
      (_command: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );

    await expect(
      discoverGuestExecutables({ exec } as never, ['git'], { timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: 'capability_probe_timeout' });
  });

  it('propagates caller cancellation to the guest probe', async () => {
    const controller = new AbortController();
    const exec = vi.fn(
      (_command: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (options.signal.aborted) {
            reject(new Error('cancelled'));
            return;
          }
          options.signal.addEventListener('abort', () =>
            reject(new Error('cancelled')),
          );
        }),
    );
    controller.abort();

    await expect(
      discoverGuestExecutables({ exec } as never, ['git'], {
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
  });
});
