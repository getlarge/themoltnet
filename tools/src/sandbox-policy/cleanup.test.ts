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

    const [first, second] = await Promise.all([
      manifest.close(),
      manifest.close(),
    ]);

    expect(order).toEqual(['two', 'one']);
    expect(first).toEqual(second);
    expect(first.every(({ cleanup }) => cleanup === 'cleaned')).toBe(true);
  });

  it('retains residue instead of hiding cleanup failure', async () => {
    const order: string[] = [];
    const manifest = new CleanupManifest();
    manifest.add('file', 'first', async () => {
      order.push('first');
    });
    manifest.add(
      'sandbox',
      'middle',
      vi.fn(async () => {
        order.push('middle');
        throw new Error('/Users/alice/still exists');
      }),
    );
    manifest.add('file', 'last', async () => {
      order.push('last');
    });

    await expect(manifest.close()).resolves.toEqual([
      expect.objectContaining({ cleanup: 'cleaned', resource: 'first' }),
      expect.objectContaining({
        cleanup: 'residue',
        reason: '<redacted sensitive diagnostic>',
        resource: 'middle',
      }),
      expect.objectContaining({ cleanup: 'cleaned', resource: 'last' }),
    ]);
    expect(order).toEqual(['last', 'middle', 'first']);
  });

  it('rejects additions after close starts', async () => {
    const manifest = new CleanupManifest();
    manifest.add('file', 'first', async () => undefined);

    const closing = manifest.close();

    expect(() => manifest.add('file', 'late', async () => undefined)).toThrow(
      'already closed',
    );
    await closing;
  });
});
