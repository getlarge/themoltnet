import { createHmac, randomBytes } from 'node:crypto';

import {
  createMetricCounter,
  createMetricUpDownCounter,
} from '@moltnet/observability';

import type { AuthContext } from './types.js';

export type RemoteAuthTransport =
  | 'oauth2'
  | 'session-cookie'
  | 'session-token'
  | 'talos';

export type RemoteAuthOperation =
  | 'kratos.session'
  | 'oauth2.client_metadata'
  | 'oauth2.introspect'
  | 'talos.agent_resolution'
  | 'talos.verify';

export type RemoteAuthOutcome =
  | 'invalid'
  | 'rate_limited'
  | 'success'
  | 'unavailable';

export interface RemoteAuthMetrics {
  recordCacheAccess(
    transport: RemoteAuthTransport,
    result: 'hit' | 'miss' | 'single_flight',
  ): void;
  recordUpstreamRequest(
    operation: RemoteAuthOperation,
    outcome: RemoteAuthOutcome,
    status?: number,
  ): void;
  recordCacheEviction(reason: 'capacity' | 'expired' | 'tag'): void;
  recordCacheSizeChange(delta: 1 | -1): void;
}

export interface RemoteAuthCacheValue {
  context: AuthContext;
  expiresAtMs?: number;
  invalidationTag?: string;
}

export interface RemoteAuthCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  metrics?: RemoteAuthMetrics;
  now?: () => number;
  hmacKey?: Uint8Array;
}

interface CacheEntry {
  context: AuthContext;
  expiresAtMs: number;
  invalidationTag?: string;
}

const NOOP_METRICS: RemoteAuthMetrics = {
  recordCacheAccess: () => undefined,
  recordUpstreamRequest: () => undefined,
  recordCacheEviction: () => undefined,
  recordCacheSizeChange: () => undefined,
};

function statusBucket(status: number | undefined): string {
  if (status === undefined) return 'network';
  if (status === 429) return '429';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

export function createRemoteAuthMetrics(): RemoteAuthMetrics {
  const cacheAccesses = createMetricCounter(
    '@moltnet/auth',
    'auth.remote.cache.accesses',
    'Remote authentication cache accesses',
  );
  const upstreamRequests = createMetricCounter(
    '@moltnet/auth',
    'auth.remote.upstream.requests',
    'Remote authentication provider requests',
  );
  const cacheEvictions = createMetricCounter(
    '@moltnet/auth',
    'auth.remote.cache.evictions',
    'Remote authentication cache evictions',
  );
  const cacheSize = createMetricUpDownCounter(
    '@moltnet/auth',
    'auth.remote.cache.entries',
    'Current remote authentication cache entries',
  );

  return {
    recordCacheAccess(transport, result) {
      cacheAccesses.add(1, { transport, result });
    },
    recordUpstreamRequest(operation, outcome, status) {
      upstreamRequests.add(1, {
        operation,
        outcome,
        status: statusBucket(status),
      });
    },
    recordCacheEviction(reason) {
      cacheEvictions.add(1, { reason });
    },
    recordCacheSizeChange(delta) {
      cacheSize.add(delta);
    },
  };
}

function freezeContext(context: AuthContext): AuthContext {
  const canonical = {
    ...context,
    scopes: Object.freeze([...context.scopes]),
    currentTeamId: null,
    ...(context.subjectType === 'agent' && context.credentialBinding
      ? { credentialBinding: Object.freeze({ ...context.credentialBinding }) }
      : {}),
  };
  return Object.freeze(canonical) as AuthContext;
}

function requestContext(context: AuthContext): AuthContext {
  return {
    ...context,
    currentTeamId: null,
  };
}

interface InFlightLoad {
  promise: Promise<RemoteAuthCacheValue | null>;
  invalidatedTags: Set<string>;
  waiters: number;
}

export class RemoteAuthCache {
  readonly metrics: RemoteAuthMetrics;

  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly hmacKey: Uint8Array;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightLoad>();
  private readonly tagKeys = new Map<string, Set<string>>();

  constructor(options: RemoteAuthCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.now = options.now ?? Date.now;
    this.hmacKey = options.hmacKey ?? randomBytes(32);
  }

  async resolve(
    transport: RemoteAuthTransport,
    issuer: string,
    credential: string,
    loader: () => Promise<RemoteAuthCacheValue | null>,
  ): Promise<AuthContext | null> {
    const key = this.digest(transport, issuer, credential);

    for (;;) {
      const cached = this.entries.get(key);
      if (cached) {
        if (cached.expiresAtMs > this.now()) {
          this.entries.delete(key);
          this.entries.set(key, cached);
          this.metrics.recordCacheAccess(transport, 'hit');
          return requestContext(cached.context);
        }
        this.deleteEntry(key, cached, 'expired');
      }

      let inFlight = this.inFlight.get(key);
      if (inFlight) {
        this.metrics.recordCacheAccess(transport, 'single_flight');
      } else {
        this.metrics.recordCacheAccess(transport, 'miss');
        inFlight = {
          promise: loader(),
          invalidatedTags: new Set<string>(),
          waiters: 0,
        };
        this.inFlight.set(key, inFlight);
      }

      inFlight.waiters += 1;
      try {
        const value = await inFlight.promise;
        if (!value) return null;

        if (
          value.invalidationTag &&
          inFlight.invalidatedTags.has(value.invalidationTag)
        ) {
          if (this.inFlight.get(key) === inFlight) {
            this.inFlight.delete(key);
          }
          continue;
        }

        const expiresAtMs = Math.min(
          this.now() + this.ttlMs,
          value.expiresAtMs ?? Number.POSITIVE_INFINITY,
        );
        const normalized = {
          ...value,
          context: freezeContext(value.context),
          expiresAtMs,
        };
        if (this.ttlMs > 0 && expiresAtMs > this.now()) {
          this.setEntry(key, normalized);
        }
        return requestContext(normalized.context);
      } finally {
        inFlight.waiters -= 1;
        if (inFlight.waiters === 0 && this.inFlight.get(key) === inFlight) {
          this.inFlight.delete(key);
        }
      }
    }
  }

  evictTag(tag: string): void {
    for (const inFlight of this.inFlight.values()) {
      inFlight.invalidatedTags.add(tag);
    }
    const keys = this.tagKeys.get(tag);
    if (!keys) return;
    for (const key of [...keys]) {
      const entry = this.entries.get(key);
      if (entry) this.deleteEntry(key, entry, 'tag');
    }
  }

  private digest(
    transport: RemoteAuthTransport,
    issuer: string,
    credential: string,
  ): string {
    const framed = [transport, issuer, credential]
      .map((part) => `${Buffer.byteLength(part)}:${part}`)
      .join('|');
    // Security note: this is a keyed, process-ephemeral cache identifier over
    // high-entropy bearer credentials, not a stored password verifier. A slow
    // password KDF here would let attacker-controlled credentials consume
    // excessive CPU on the authentication hot path. HMAC prevents a leaked
    // cache key from revealing or validating the credential without this
    // process's random key.
    // codeql[js/insufficient-password-hash]
    return createHmac('sha256', this.hmacKey)
      .update(framed)
      .digest('base64url');
  }

  private setEntry(key: string, entry: CacheEntry): void {
    const previous = this.entries.get(key);
    if (previous) this.deleteEntry(key, previous);
    this.entries.set(key, entry);
    this.metrics.recordCacheSizeChange(1);
    if (entry.invalidationTag) {
      const keys = this.tagKeys.get(entry.invalidationTag) ?? new Set<string>();
      keys.add(key);
      this.tagKeys.set(entry.invalidationTag, keys);
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.deleteEntry(oldestKey, oldest, 'capacity');
    }
  }

  private deleteEntry(
    key: string,
    entry: CacheEntry,
    reason?: 'capacity' | 'expired' | 'tag',
  ): void {
    this.entries.delete(key);
    this.metrics.recordCacheSizeChange(-1);
    if (reason) this.metrics.recordCacheEviction(reason);
    if (!entry.invalidationTag) return;
    const keys = this.tagKeys.get(entry.invalidationTag);
    keys?.delete(key);
    if (keys?.size === 0) this.tagKeys.delete(entry.invalidationTag);
  }
}
