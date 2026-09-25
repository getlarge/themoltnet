import { createMetricCounter } from '@moltnet/observability';

export interface PermissionTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_set: { namespace: string; object: string; relation: string };
}

export interface PermissionCheckCacheOptions {
  /** Zero disables retained results; in-flight checks can still coalesce. */
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  /** Return zero for relations that must always be checked live. */
  ttlFor?: (tuple: PermissionTuple) => number;
}

const accesses = createMetricCounter(
  '@moltnet/auth',
  'auth.keto.cache.accesses',
  'Keto permission cache accesses',
);
const calls = createMetricCounter(
  '@moltnet/auth',
  'auth.keto.calls',
  'Outbound Keto permission calls',
);

/** A per-process positive-only LRU shared by single and batch checks. */
export class PermissionCheckCache {
  private readonly entries = new Map<string, number>();
  private readonly flights = new Map<string, Promise<boolean>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly ttlFor: (tuple: PermissionTuple) => number;

  constructor(options: PermissionCheckCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    if (this.ttlMs < 0 || !Number.isFinite(this.ttlMs)) {
      throw new Error(
        'Permission cache TTL must be a finite nonnegative number',
      );
    }
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error('Permission cache size must be a positive integer');
    }
    this.now = options.now ?? Date.now;
    this.ttlFor =
      options.ttlFor ??
      ((tuple) =>
        tuple.relation === 'read' ||
        tuple.relation === 'view' ||
        tuple.relation === 'access'
          ? this.ttlMs
          : 0);
  }

  recordCall(
    kind: 'single' | 'batch',
    outcome: 'ok' | 'partial_error' | 'error',
  ): void {
    calls.add(1, { kind, outcome });
  }

  private key(tuple: PermissionTuple): string {
    return JSON.stringify([
      tuple.namespace,
      tuple.object,
      tuple.relation,
      tuple.subject_set.namespace,
      tuple.subject_set.object,
      tuple.subject_set.relation,
    ]);
  }

  private cached(key: string): boolean {
    const expires = this.entries.get(key);
    if (expires === undefined) return false;
    this.entries.delete(key);
    if (expires <= this.now()) return false;
    this.entries.set(key, expires);
    return true;
  }

  private save(key: string, ttl: number): void {
    if (ttl <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, this.now() + ttl);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  async check(
    tuple: PermissionTuple,
    load: () => Promise<boolean>,
  ): Promise<boolean> {
    const ttl = this.ttlFor(tuple);
    const key = this.key(tuple);
    if (ttl > 0 && this.cached(key)) {
      accesses.add(1, { result: 'hit' });
      return true;
    }
    const existing = this.flights.get(key);
    if (existing) {
      accesses.add(1, { result: 'single_flight' });
      return existing;
    }
    accesses.add(1, { result: ttl > 0 ? 'miss' : 'bypass' });
    const promise = load().then((allowed) => {
      if (allowed) this.save(key, ttl);
      return allowed;
    });
    this.flights.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.flights.get(key) === promise) this.flights.delete(key);
    }
  }

  async batch(
    tuples: PermissionTuple[],
    load: (misses: PermissionTuple[]) => Promise<boolean[]>,
  ): Promise<boolean[]> {
    if (tuples.length === 0) return [];
    const misses: PermissionTuple[] = [];
    const pending: Array<{
      key: string;
      tuple: PermissionTuple;
      resolve: (allowed: boolean) => void;
      reject: (error: unknown) => void;
      promise: Promise<boolean>;
      missIndex: number;
    }> = [];
    const results = tuples.map((tuple) => {
      const ttl = this.ttlFor(tuple);
      const key = this.key(tuple);
      if (ttl > 0 && this.cached(key)) {
        accesses.add(1, { result: 'hit' });
        return Promise.resolve(true);
      }
      const existing = this.flights.get(key);
      if (existing) {
        accesses.add(1, { result: 'single_flight' });
        return existing;
      }
      accesses.add(1, { result: ttl > 0 ? 'miss' : 'bypass' });
      let resolve!: (allowed: boolean) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<boolean>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // A failing batch can reject before Promise.all installs its handlers.
      void promise.catch(() => undefined);
      const item = {
        key,
        tuple,
        resolve,
        reject,
        promise,
        missIndex: misses.length,
      };
      pending.push(item);
      misses.push(tuple);
      this.flights.set(key, promise);
      return promise;
    });

    if (misses.length > 0) {
      try {
        const loaded = await load(misses);
        for (const item of pending) {
          const allowed = loaded[item.missIndex] ?? false;
          if (allowed) this.save(item.key, this.ttlFor(item.tuple));
          item.resolve(allowed);
        }
      } catch (error) {
        for (const item of pending) item.reject(error);
        throw error;
      } finally {
        for (const item of pending) {
          if (this.flights.get(item.key) === item.promise)
            this.flights.delete(item.key);
        }
      }
    }
    return Promise.all(results);
  }
}
