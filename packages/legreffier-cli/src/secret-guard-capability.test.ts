import { describe, expect, it, vi } from 'vitest';

import { assertSecretGuardCapability } from './secret-guard-capability.js';

describe('assertSecretGuardCapability', () => {
  it('accepts a CLI that exposes the guard command', async () => {
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(assertSecretGuardCapability(run)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects hook installation when the CLI is missing or too old', async () => {
    const run = vi.fn().mockRejectedValue(new Error('unknown command'));

    await expect(assertSecretGuardCapability(run)).rejects.toThrow(
      'Update @themoltnet/cli before installing fail-closed agent hooks',
    );
  });
});
