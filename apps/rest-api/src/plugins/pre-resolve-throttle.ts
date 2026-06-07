/**
 * Pre-resolution IP throttle.
 *
 * The auth plugin resolves request.authContext in an `onRequest` hook (so the
 * rate limiter can key by verified identity — issue #1336). That resolution does
 * network I/O for opaque tokens (Hydra introspection) and Kratos sessions
 * (toSession). Without a guard in front of it, an attacker spraying
 * session-cookie / opaque-token garbage would amplify load onto Hydra/Kratos
 * before the identity limiter (which runs AFTER resolution) could throttle them.
 *
 * This is a coarse anti-amplification ceiling, NOT the per-principal budget:
 * a generous per-IP fixed-window counter that runs BEFORE resolution and caps
 * how many resolution attempts any single IP can trigger per window. Legitimate
 * clients (even many behind one NAT) should never hit it; a single-IP spray
 * does. The per-identity budget is enforced later by the main limiter.
 *
 * In-memory and per-instance for now; a shared (Redis) store is tracked in the
 * rate-limiter refinement follow-up. The entry map is bounded so unique-IP spray
 * cannot grow memory without limit.
 */

interface Window {
  count: number;
  /** epoch ms when the current window resets */
  resetAt: number;
}

export interface PreResolveThrottle {
  /**
   * Record one hit for `key`. Returns null if under the limit, or the seconds
   * until reset (>=1) if the limit is now exceeded.
   */
  hit(key: string, nowMs: number): number | null;
  /** Current number of tracked keys (for tests/observability). */
  size(): number;
}

/**
 * Create a bounded fixed-window per-key counter.
 *
 * @param max         allowed hits per window
 * @param windowMs    window length in ms
 * @param maxEntries  hard cap on tracked keys; when exceeded, expired entries
 *                    are swept and, if still over, the oldest entries are
 *                    dropped. Bounds memory under unique-key (spray) load.
 */
export function createPreResolveThrottle(
  max: number,
  windowMs: number,
  maxEntries = 100_000,
): PreResolveThrottle {
  const windows = new Map<string, Window>();

  function sweep(nowMs: number): void {
    for (const [key, w] of windows) {
      if (w.resetAt <= nowMs) windows.delete(key);
    }
    // Still over budget after removing expired windows: drop oldest-inserted
    // entries (Map preserves insertion order) until back under the cap.
    if (windows.size > maxEntries) {
      const overflow = windows.size - maxEntries;
      let dropped = 0;
      for (const key of windows.keys()) {
        windows.delete(key);
        if (++dropped >= overflow) break;
      }
    }
  }

  return {
    hit(key: string, nowMs: number): number | null {
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= nowMs) {
        if (windows.size >= maxEntries) sweep(nowMs);
        windows.set(key, { count: 1, resetAt: nowMs + windowMs });
        return null;
      }
      existing.count += 1;
      if (existing.count > max) {
        return Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000));
      }
      return null;
    },
    size(): number {
      return windows.size;
    },
  };
}
