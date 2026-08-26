import { describe, expect, it, vi } from 'vitest';

import { retirePiExtensionVm } from './index.js';

describe('retirePiExtensionVm', () => {
  it('releases the failed VM so the next tool call can provision a fresh one', async () => {
    const firstVm = {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    };
    const freshVm = { close: vi.fn() };
    let currentVm: typeof firstVm | typeof freshVm | null = firstVm;
    let vmStarting: Promise<typeof freshVm> | null = Promise.resolve(freshVm);
    const provisionFreshVm = vi.fn(() => {
      currentVm = freshVm;
      return Promise.resolve(freshVm);
    });
    const ensureVm = async () => currentVm ?? provisionFreshVm();

    await expect(
      retirePiExtensionVm({
        activeVm: firstVm,
        retirement: {
          backendRetired: false,
          reason: 'backend-retirement-failed',
          trigger: 'cancellation',
        },
        release: () => {
          if (currentVm === firstVm) {
            currentVm = null;
            vmStarting = null;
          }
        },
      }),
    ).rejects.toThrow('close failed');

    expect(currentVm).toBeNull();
    expect(vmStarting).toBeNull();
    await expect(ensureVm()).resolves.toBe(freshVm);
    expect(provisionFreshVm).toHaveBeenCalledOnce();
  });

  it('releases ownership without a second close after backend retirement', async () => {
    const activeVm = { close: vi.fn() };
    const release = vi.fn();

    await retirePiExtensionVm({
      activeVm,
      retirement: {
        backendRetired: true,
        reason: 'backend-retired',
        trigger: 'timeout',
      },
      release,
    });

    expect(activeVm.close).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
