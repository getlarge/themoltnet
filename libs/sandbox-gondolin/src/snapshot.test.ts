import { afterEach, describe, expect, it } from 'vitest';

import { resolveSnapshotVmm, snapshotCacheKey } from './snapshot.js';

const ORIGINAL = process.env.GONDOLIN_VMM;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GONDOLIN_VMM;
  else process.env.GONDOLIN_VMM = ORIGINAL;
});

describe('snapshot cache key', () => {
  it('resolves the backend from GONDOLIN_VMM with a qemu default', () => {
    expect(resolveSnapshotVmm({})).toBe('qemu');
    expect(resolveSnapshotVmm({ GONDOLIN_VMM: 'krun' })).toBe('krun');
    expect(resolveSnapshotVmm({ GONDOLIN_VMM: ' KRUN ' })).toBe('krun');
    expect(resolveSnapshotVmm({ GONDOLIN_VMM: 'qemu' })).toBe('qemu');
    expect(resolveSnapshotVmm({ GONDOLIN_VMM: 'nonsense' })).toBe('qemu');
  });

  it('separates qemu and krun snapshot caches for the same config', () => {
    // A gondolin checkpoint refuses to resume under a backend it was not
    // built for; sharing a cache dir across backends bricks every run
    // after a backend switch (the signed bundle defaults to krun).
    delete process.env.GONDOLIN_VMM;
    const qemuKey = snapshotCacheKey({});
    process.env.GONDOLIN_VMM = 'krun';
    const krunKey = snapshotCacheKey({});
    expect(qemuKey).not.toBe(krunKey);
    expect(qemuKey).toMatch(/^v2-[0-9a-f]{12}$/);
    expect(krunKey).toMatch(/^v2-[0-9a-f]{12}$/);
  });

  it('keeps the key stable for identical config and backend', () => {
    process.env.GONDOLIN_VMM = 'krun';
    expect(snapshotCacheKey({ overlaySize: '3G' })).toBe(
      snapshotCacheKey({ overlaySize: '3G' }),
    );
  });
});
