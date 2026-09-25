/**
 * Shares catalogue source reads between callers.
 *
 * The Run Center poll, the tray and every view that refreshes all ask for the
 * same identity's catalogue, and each read verifies every team credential
 * against the API. Run concurrently, those reads multiply the API calls enough
 * to be throttled, and a throttled read waits out its retries until Desktop
 * times out. So concurrent callers join one read, and a healthy result is
 * reused for a few seconds. An explicit refresh always reads fresh.
 *
 * Only the remote sources are shared, one entry per identity and team, so a
 * degraded team never forces its healthy siblings to be verified again.
 * Machine readiness and the identity binding are local and assembled fresh on
 * every request.
 */
/** Long enough to merge the poll, tray and views asking at once; no longer. */
export const CATALOGUE_CACHE_TTL_MS = 10_000;

interface Slot<T> {
  pending?: Promise<T>;
  /** A reusable result, until `expiresAt`. */
  value?: T;
  expiresAt: number;
  /** The latest result, served while abandoned work for this key still runs. */
  last?: T;
}

/** Registers work a read gave up waiting for but could not cancel. */
export type HoldAbandonedWork = (work: Promise<unknown>) => void;

export class CatalogueSourceCache<T> {
  readonly #slots = new Map<string, Slot<T>>();
  /**
   * Abandoned work per key. Kept apart from the slots so invalidation, which
   * discards results, cannot forget that a lookup is still stuck.
   */
  readonly #held = new Map<string, Promise<unknown>>();
  readonly #ttlMs: number;
  readonly #reusable: (value: T) => boolean;
  readonly #now: () => number;

  constructor(options: {
    ttlMs?: number;
    /** A degraded read is shared with concurrent callers but never kept. */
    reusable: (value: T) => boolean;
    now?: () => number;
  }) {
    this.#ttlMs = options.ttlMs ?? CATALOGUE_CACHE_TTL_MS;
    this.#reusable = options.reusable;
    this.#now = options.now ?? Date.now;
  }

  read(key: string, load: (hold: HoldAbandonedWork) => Promise<T>): Promise<T> {
    this.#prune();
    let slot = this.#slots.get(key);
    if (!slot) {
      slot = { expiresAt: 0 };
      this.#slots.set(key, slot);
    }
    if (slot.value !== undefined && this.#now() < slot.expiresAt)
      return Promise.resolve(slot.value);
    if (slot.pending) return slot.pending;
    // A lookup that ignored its deadline is still running. Starting another
    // would pile more stuck work onto the same team; answer as last time.
    if (this.#held.has(key) && slot.last !== undefined)
      return Promise.resolve(slot.last);
    const own = slot;
    // A read whose slot was invalidated meanwhile answers its callers but
    // writes nothing: its slot is no longer in the map.
    const current = () => this.#slots.get(key) === own;
    const pending = load((work) => this.#hold(key, work)).then(
      (value) => {
        if (current()) {
          own.pending = undefined;
          own.last = value;
          if (this.#ttlMs > 0 && this.#reusable(value)) {
            own.value = value;
            own.expiresAt = this.#now() + this.#ttlMs;
          } else {
            own.value = undefined;
          }
        }
        return value;
      },
      (error: unknown) => {
        if (current()) own.pending = undefined;
        throw error;
      },
    );
    own.pending = pending;
    return pending;
  }

  /**
   * Drop every key starting with `prefix`, or every key; reads in flight
   * finish but are not kept.
   */
  invalidate(prefix = ''): void {
    for (const key of [...this.#slots.keys()])
      if (key.startsWith(prefix)) this.#slots.delete(key);
  }

  /** Entries currently retained; for tests. */
  get size(): number {
    return this.#slots.size;
  }

  #hold(key: string, work: Promise<unknown>): void {
    this.#held.set(key, work);
    const release = () => {
      if (this.#held.get(key) === work) this.#held.delete(key);
    };
    work.then(release, release);
  }

  /** Forget entries with nothing to serve, so churned identities do not accumulate. */
  #prune(): void {
    const now = this.#now();
    for (const [key, slot] of this.#slots) {
      if (slot.pending || this.#held.has(key)) continue;
      if (slot.value !== undefined && now < slot.expiresAt) continue;
      this.#slots.delete(key);
    }
  }
}
