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
 * Only the remote sources are shared. Machine readiness and the identity
 * binding are local and assembled fresh on every request.
 */
/** Long enough to merge the poll, tray and views asking at once; no longer. */
export const CATALOGUE_CACHE_TTL_MS = 10_000;

interface Slot<T> {
  /** Bumped by invalidation so a read started earlier cannot repopulate. */
  generation: number;
  pending?: Promise<T>;
  value?: T;
  expiresAt: number;
}

export class CatalogueSourceCache<T> {
  readonly #slots = new Map<string, Slot<T>>();
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

  read(key: string, load: () => Promise<T>): Promise<T> {
    const slot = this.#slot(key);
    if (slot.value !== undefined && this.#now() < slot.expiresAt)
      return Promise.resolve(slot.value);
    if (slot.pending) return slot.pending;
    const generation = slot.generation;
    const pending = load().then(
      (value) => {
        if (slot.generation === generation) {
          slot.pending = undefined;
          if (this.#ttlMs > 0 && this.#reusable(value)) {
            slot.value = value;
            slot.expiresAt = this.#now() + this.#ttlMs;
          } else {
            slot.value = undefined;
          }
        }
        return value;
      },
      (error: unknown) => {
        if (slot.generation === generation) slot.pending = undefined;
        throw error;
      },
    );
    slot.pending = pending;
    return pending;
  }

  /** Drop a key, or every key; reads in flight finish but are not kept. */
  invalidate(key?: string): void {
    const slots = key === undefined ? this.#slots.values() : [this.#slot(key)];
    for (const slot of slots) {
      slot.generation += 1;
      slot.pending = undefined;
      slot.value = undefined;
    }
  }

  #slot(key: string): Slot<T> {
    let slot = this.#slots.get(key);
    if (!slot) {
      slot = { generation: 0, expiresAt: 0 };
      this.#slots.set(key, slot);
    }
    return slot;
  }
}
