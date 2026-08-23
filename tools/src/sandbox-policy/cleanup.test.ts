import { describe, expect, it, vi } from 'vitest';

import { CleanupManifest } from './cleanup.js';

describe('sandbox policy cleanup manifest', () => {
  it('cleans in reverse order and remains idempotent', async () => {
    const order: string[] = [];
    const manifest = new CleanupManifest();
    manifest.add('file', '$PROBE_ROOT/one', async () => {
      order.push('one');
    });
    manifest.add('sandbox', 'moltnet-1972-run', async () => {
      order.push('two');
    });

    const first = await manifest.close();
    const second = await manifest.close();

    expect(order).toEqual(['two', 'one']);
    expect(first).toEqual(second);
    expect(first.every(({ cleanup }) => cleanup === 'cleaned')).toBe(true);
  });

  it('retains residue instead of hiding cleanup failure', async () => {
    const cleanup = vi.fn(async () => {
      throw new Error('still exists');
    });
    const manifest = new CleanupManifest();
    manifest.add('sandbox', 'moltnet-1972-run', cleanup);

    await expect(manifest.close()).resolves.toEqual([
      expect.objectContaining({
        cleanup: 'residue',
        reason: 'still exists',
      }),
    ]);
  });
});
