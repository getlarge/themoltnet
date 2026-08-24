import { describe, expect, it, vi } from 'vitest';

import { execGondolinGuest } from './gondolin-adapter.js';

function completedExec(exitCode = 0, output = '') {
  return Object.assign(Promise.resolve({ exitCode }), {
    output: async function* () {
      await Promise.resolve();
      yield {
        data: Buffer.from(output),
        stream: 'stdout' as const,
      };
    },
  });
}

describe('Gondolin research adapter guest transport', () => {
  it('preserves a successful managed result and guest output', async () => {
    const exec = vi.fn(() => completedExec(0, 'ok'));

    await expect(
      execGondolinGuest({ vm: { exec } } as never, 'printf ok'),
    ).resolves.toEqual({
      exitCode: 0,
      output: 'ok',
      termination: { status: 'not-required' },
    });
    expect(exec).toHaveBeenCalledWith(
      ['/bin/sh', '-lc', 'printf ok'],
      expect.any(Object),
    );
  });

  it('does not turn transport failure into a guest exit code', async () => {
    const transportError = new Error('VM transport disconnected');
    const exec = vi.fn(() => {
      throw transportError;
    });

    await expect(
      execGondolinGuest({ vm: { exec } } as never, 'false'),
    ).rejects.toBe(transportError);
  });
});
