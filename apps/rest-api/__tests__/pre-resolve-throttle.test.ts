import { describe, expect, it } from 'vitest';

import { createPreResolveThrottle } from '../src/plugins/pre-resolve-throttle.js';

describe('createPreResolveThrottle', () => {
  it('allows up to max hits per window, then reports retry-after', () => {
    const t = createPreResolveThrottle(3, 60_000);
    const now = 1_000_000;
    expect(t.hit('ip', now)).toBeNull();
    expect(t.hit('ip', now)).toBeNull();
    expect(t.hit('ip', now)).toBeNull();
    // 4th hit exceeds max=3.
    const retry = t.hit('ip', now);
    expect(retry).not.toBeNull();
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it('resets after the window elapses', () => {
    const t = createPreResolveThrottle(1, 60_000);
    const now = 1_000_000;
    expect(t.hit('ip', now)).toBeNull();
    expect(t.hit('ip', now)).not.toBeNull(); // blocked within window
    // After the window, the counter resets.
    expect(t.hit('ip', now + 60_000)).toBeNull();
  });

  it('tracks distinct keys independently', () => {
    const t = createPreResolveThrottle(1, 60_000);
    const now = 1_000_000;
    expect(t.hit('ip-a', now)).toBeNull();
    expect(t.hit('ip-b', now)).toBeNull(); // different key, own budget
    expect(t.hit('ip-a', now)).not.toBeNull();
  });

  it('bounds the number of tracked keys under unique-key spray', () => {
    const t = createPreResolveThrottle(10, 60_000, 100);
    const now = 1_000_000;
    for (let i = 0; i < 1000; i++) {
      t.hit(`ip-${i}`, now);
    }
    // Never grows unbounded: stays at or below the cap (+ at most one fresh
    // insert past a sweep).
    expect(t.size()).toBeLessThanOrEqual(101);
  });

  it('reports retry-after of at least 1 second even near window end', () => {
    const t = createPreResolveThrottle(1, 60_000);
    const now = 1_000_000;
    t.hit('ip', now);
    // 1ms before reset, retry-after rounds up to >=1.
    const retry = t.hit('ip', now + 59_999);
    expect(retry).toBe(1);
  });
});
