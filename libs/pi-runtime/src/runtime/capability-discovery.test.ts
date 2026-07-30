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
      'sh',
      '-c',
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
    ).rejects.toThrow('capability probe failed');
  });
});
