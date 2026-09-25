import { describe, expect, it, vi } from 'vitest';

import { CatalogueSourceCache } from './catalogue-cache.js';

interface Read {
  healthy: boolean;
  n: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cache(now = () => 0) {
  return new CatalogueSourceCache<Read>({
    ttlMs: 20_000,
    reusable: (value) => value.healthy,
    now,
  });
}

describe('CatalogueSourceCache', () => {
  it('joins concurrent callers onto one read', async () => {
    // Arrange
    const subject = cache();
    const read = deferred<Read>();
    const load = vi.fn(() => read.promise);

    // Act
    const first = subject.read('bot', load);
    const second = subject.read('bot', load);
    read.resolve({ healthy: true, n: 1 });

    // Assert
    expect(await first).toEqual({ healthy: true, n: 1 });
    expect(await second).toEqual({ healthy: true, n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reuses a healthy read until it expires', async () => {
    // Arrange
    let time = 0;
    const subject = cache(() => time);
    let n = 0;
    const load = vi.fn(() => Promise.resolve({ healthy: true, n: ++n }));

    // Act
    await subject.read('bot', load);
    time = 19_999;
    const reused = await subject.read('bot', load);
    time = 20_000;
    const refreshed = await subject.read('bot', load);

    // Assert
    expect(reused.n).toBe(1);
    expect(refreshed.n).toBe(2);
  });

  it('never keeps a degraded read', async () => {
    // Arrange
    const subject = cache();
    let n = 0;
    const load = vi.fn(() => Promise.resolve({ healthy: n++ > 0, n }));

    // Act
    const degraded = await subject.read('bot', load);
    const next = await subject.read('bot', load);

    // Assert: the transient failure did not outlive its read.
    expect(degraded.healthy).toBe(false);
    expect(next.healthy).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    // Arrange
    const subject = cache();
    const load = vi
      .fn<() => Promise<Read>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ healthy: true, n: 2 });

    // Act
    await expect(subject.read('bot', load)).rejects.toThrow('offline');
    const next = await subject.read('bot', load);

    // Assert
    expect(next.n).toBe(2);
  });

  it('starts a fresh read after invalidation, even while one is in flight', async () => {
    // Arrange: a renewal lands while a read with the old credential is running.
    const subject = cache();
    const stale = deferred<Read>();
    const load = vi
      .fn<() => Promise<Read>>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ healthy: true, n: 2 })
      .mockResolvedValueOnce({ healthy: true, n: 3 });
    const before = subject.read('bot', load);

    // Act
    subject.invalidate('bot');
    const after = await subject.read('bot', load);
    stale.resolve({ healthy: true, n: 1 });
    await before;
    const reused = await subject.read('bot', load);

    // Assert: the old read neither served the new caller nor repopulated.
    expect(after.n).toBe(2);
    expect(reused.n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidates only the keys under a prefix', async () => {
    // Arrange: two teams of one identity, and another identity.
    const subject = cache();
    let n = 0;
    const load = vi.fn(() => Promise.resolve({ healthy: true, n: ++n }));
    await subject.read('bot\u0000team-a', load);
    await subject.read('bot\u0000team-b', load);
    await subject.read('other\u0000team-a', load);

    // Act
    subject.invalidate('bot\u0000');
    await subject.read('bot\u0000team-a', load);
    await subject.read('bot\u0000team-b', load);
    await subject.read('other\u0000team-a', load);

    // Assert: both of bot's teams re-read; the other identity reused.
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('keeps identities apart and invalidates all of them at once', async () => {
    // Arrange
    const subject = cache();
    let n = 0;
    const load = vi.fn(() => Promise.resolve({ healthy: true, n: ++n }));
    await subject.read('a', load);
    await subject.read('b', load);

    // Act
    subject.invalidate();
    await subject.read('a', load);
    await subject.read('b', load);

    // Assert
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not start more work while an abandoned lookup is still stuck', async () => {
    // Arrange: a read that timed out, leaving an uncancellable lookup behind.
    const subject = cache();
    const stuck = deferred<void>();
    const load = vi.fn((hold: (work: Promise<unknown>) => void) => {
      hold(stuck.promise);
      return Promise.resolve({ healthy: false, n: load.mock.calls.length });
    });

    // Act
    const first = await subject.read('bot\u0000team-a', load);
    const whileStuck = await subject.read('bot\u0000team-a', load);
    stuck.resolve();
    await stuck.promise;
    const afterwards = await subject.read('bot\u0000team-a', load);

    // Assert: the recovery poll got the last answer, not another lookup.
    expect(whileStuck).toBe(first);
    expect(afterwards.n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets expired, degraded and invalidated entries', async () => {
    // Arrange
    let time = 0;
    const subject = cache(() => time);
    await subject.read('a', () => Promise.resolve({ healthy: true, n: 1 }));
    await subject.read('b', () => Promise.resolve({ healthy: false, n: 2 }));
    await subject.read('c', () => Promise.resolve({ healthy: true, n: 3 }));

    // Act
    subject.invalidate('c');
    time = 20_000;
    await subject.read('d', () => Promise.resolve({ healthy: true, n: 4 }));

    // Assert: only the entry just read remains.
    expect(subject.size).toBe(1);
  });
});
