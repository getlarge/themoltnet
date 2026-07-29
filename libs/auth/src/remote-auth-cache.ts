import { createHmac, randomBytes } from 'node:crypto';

import { createMetricCounter } from '@moltnet/observability';

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
};

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

  return {
    recordCacheAccess(transport, result) {
      cacheAccesses.add(1, { transport, result });
    },
    recordUpstreamRequest(operation, outcome, status) {
      upstreamRequests.add(1, {
        operation,
        outcome,
        ...(status === undefined ? {} : { status }),
      });
    },
  };
}

function cloneContext(context: AuthContext): AuthContext {
  return {
    ...context,
    scopes: [...context.scopes],
    currentTeamId: null,
    ...(context.subjectType === 'agent' && context.credentialBinding
      ? { credentialBinding: { ...context.credentialBinding } }
      : {}),
  };
}

export class RemoteAuthCache {
  readonly metrics: RemoteAuthMetrics;

  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly hmacKey: Uint8Array;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<RemoteAuthCacheValue | null>
  >();
  private readonly tagKeys = new Map<string, Set<string>>();
  private evictionEpoch = 0;

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
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.expiresAtMs > this.now()) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        this.metrics.recordCacheAccess(transport, 'hit');
        return cloneContext(cached.context);
      }
      this.deleteEntry(key, cached);
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      this.metrics.recordCacheAccess(transport, 'single_flight');
      const value = await existing;
      return value ? cloneContext(value.context) : null;
    }

    this.metrics.recordCacheAccess(transport, 'miss');
    const loadEpoch = this.evictionEpoch;
    const promise = loader();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      if (!value) return null;

      const expiresAtMs = Math.min(
        this.now() + this.ttlMs,
        value.expiresAtMs ?? Number.POSITIVE_INFINITY,
      );
      const normalized = {
        ...value,
        context: cloneContext(value.context),
        expiresAtMs,
      };
      if (
        this.ttlMs > 0 &&
        expiresAtMs > this.now() &&
        loadEpoch === this.evictionEpoch
      ) {
        this.setEntry(key, normalized);
      }
      return cloneContext(normalized.context);
    } finally {
      this.inFlight.delete(key);
    }
  }

  evictTag(tag: string): void {
    this.evictionEpoch += 1;
    const keys = this.tagKeys.get(tag);
    if (!keys) return;
    for (const key of [...keys]) {
      const entry = this.entries.get(key);
      if (entry) this.deleteEntry(key, entry);
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
    // This is a keyed, process-ephemeral cache identifier, not a password
    // verifier. HMAC prevents an exposed key from revealing or validating the
    // raw credential without also possessing this process's random key.
    return createHmac('sha256', this.hmacKey)
      .update(framed)
      .digest('base64url');
  }

  private setEntry(key: string, entry: CacheEntry): void {
    const previous = this.entries.get(key);
    if (previous) this.deleteEntry(key, previous);
    this.entries.set(key, entry);
    if (entry.invalidationTag) {
      const keys = this.tagKeys.get(entry.invalidationTag) ?? new Set<string>();
      keys.add(key);
      this.tagKeys.set(entry.invalidationTag, keys);
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.deleteEntry(oldestKey, oldest);
    }
  }

  private deleteEntry(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    if (!entry.invalidationTag) return;
    const keys = this.tagKeys.get(entry.invalidationTag);
    keys?.delete(key);
    if (keys?.size === 0) this.tagKeys.delete(entry.invalidationTag);
  }
}
