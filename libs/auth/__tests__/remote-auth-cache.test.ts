import { describe, expect, it, vi } from 'vitest';

import {
  RemoteAuthCache,
  type RemoteAuthMetrics,
} from '../src/remote-auth-cache.js';
import type { AgentAuthContext } from '../src/types.js';

const context: AgentAuthContext = {
  subjectType: 'agent',
  identityId: 'identity-1',
  publicKey: 'public-key',
  fingerprint: 'fingerprint',
  clientId: 'key-1',
  scopes: ['entries:read'],
  currentTeamId: null,
  credentialBinding: { keyId: 'key-1', boundTeamId: 'team-1' },
};

function loader(
  overrides: {
    expiresAtMs?: number;
    invalidationTag?: string;
  } = {},
) {
  return vi.fn(async () => ({ context, ...overrides }));
}

describe('RemoteAuthCache', () => {
  it('caches positive results until the configured TTL', async () => {
    let now = 1_000;
    const cache = new RemoteAuthCache({ ttlMs: 100, now: () => now });
    const load = loader();

    await cache.resolve('talos', 'issuer', 'secret', load);
    now = 1_099;
    await cache.resolve('talos', 'issuer', 'secret', load);
    now = 1_100;
    await cache.resolve('talos', 'issuer', 'secret', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caps cache lifetime at the credential expiry', async () => {
    let now = 1_000;
    const cache = new RemoteAuthCache({ ttlMs: 1_000, now: () => now });
    const load = loader({ expiresAtMs: 1_050 });

    await cache.resolve('oauth2', 'issuer', 'secret', load);
    now = 1_050;
    await cache.resolve('oauth2', 'issuer', 'secret', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('models the bounded revocation-staleness window', async () => {
    let now = 1_000;
    const cache = new RemoteAuthCache({ ttlMs: 100, now: () => now });
    const load = loader();

    expect(
      await cache.resolve('talos', 'issuer', 'revoked-later', load),
    ).toEqual(context);
    load.mockResolvedValue(null as never);
    now = 1_099;
    expect(
      await cache.resolve('talos', 'issuer', 'revoked-later', load),
    ).toEqual(context);
    now = 1_100;
    expect(
      await cache.resolve('talos', 'issuer', 'revoked-later', load),
    ).toBeNull();
  });

  it('evicts the least recently used entry at the size bound', async () => {
    const cache = new RemoteAuthCache({ maxEntries: 2 });
    const first = loader();
    const second = loader();
    const third = loader();

    await cache.resolve('talos', 'issuer', 'first', first);
    await cache.resolve('talos', 'issuer', 'second', second);
    await cache.resolve('talos', 'issuer', 'first', first);
    await cache.resolve('talos', 'issuer', 'third', third);
    await cache.resolve('talos', 'issuer', 'second', second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent success, invalid, and error loads without caching failures', async () => {
    for (const result of [
      { context },
      null,
      new Error('provider unavailable'),
    ]) {
      let settle!: () => void;
      const gate = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const load = vi.fn(async () => {
        await gate;
        if (result instanceof Error) throw result;
        return result;
      });
      const cache = new RemoteAuthCache();
      const first = cache.resolve('oauth2', 'issuer', 'secret', load);
      const second = cache.resolve('oauth2', 'issuer', 'secret', load);
      settle();

      if (result instanceof Error) {
        await expect(first).rejects.toBe(result);
        await expect(second).rejects.toBe(result);
      } else {
        await Promise.all([first, second]);
      }
      expect(load).toHaveBeenCalledTimes(1);

      if (result === null || result instanceof Error) {
        const retry = vi.fn(async () => null);
        await cache.resolve('oauth2', 'issuer', 'secret', retry);
        expect(retry).toHaveBeenCalledOnce();
      }
    }
  });

  it('keeps positive storage disabled at TTL zero while preserving single-flight', async () => {
    const cache = new RemoteAuthCache({ ttlMs: 0 });
    const load = loader();

    await Promise.all([
      cache.resolve('talos', 'issuer', 'secret', load),
      cache.resolve('talos', 'issuer', 'secret', load),
    ]);
    await cache.resolve('talos', 'issuer', 'secret', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts tagged Talos entries and returns isolated team-neutral clones', async () => {
    const cache = new RemoteAuthCache();
    const load = loader({ invalidationTag: 'talos-key:key-1' });

    const first = await cache.resolve('talos', 'issuer', 'secret', load);
    expect(first).not.toBe(context);
    first!.currentTeamId = 'request-team';
    first!.scopes.push('entries:write');
    if (first?.subjectType === 'agent' && first.credentialBinding) {
      first.credentialBinding.boundTeamId = 'mutated';
    }

    const second = await cache.resolve('talos', 'issuer', 'secret', load);
    expect(second).toEqual(context);

    cache.evictTag('talos-key:key-1');
    await cache.resolve('talos', 'issuer', 'secret', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate a stale entry when eviction races an in-flight load', async () => {
    const cache = new RemoteAuthCache();
    let settle!: () => void;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const load = vi.fn(async () => {
      await gate;
      return {
        context,
        invalidationTag: 'talos-key:key-1',
      };
    });

    const first = cache.resolve('talos', 'issuer', 'secret', load);
    cache.evictTag('talos-key:key-1');
    settle();
    await first;
    await cache.resolve('talos', 'issuer', 'secret', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('emits only low-cardinality cache dimensions', async () => {
    const metrics: RemoteAuthMetrics = {
      recordCacheAccess: vi.fn(),
      recordUpstreamRequest: vi.fn(),
    };
    const cache = new RemoteAuthCache({
      metrics,
      hmacKey: new Uint8Array(32),
    });
    const load = loader();

    await cache.resolve('talos', 'https://issuer', 'raw-secret', load);
    await cache.resolve('talos', 'https://issuer', 'raw-secret', load);

    expect(metrics.recordCacheAccess).toHaveBeenNthCalledWith(
      1,
      'talos',
      'miss',
    );
    expect(metrics.recordCacheAccess).toHaveBeenNthCalledWith(
      2,
      'talos',
      'hit',
    );
    expect(JSON.stringify(metrics.recordCacheAccess.mock.calls)).not.toContain(
      'raw-secret',
    );
  });
});
