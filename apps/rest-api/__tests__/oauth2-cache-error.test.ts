import type {
  RedisLikeClient,
  TokenExchangeMetrics,
} from '@moltnet/oauth-token-cache';
import Fastify from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { oauth2GrantCachePlugin, oauth2Routes } from '../src/routes/oauth2.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function fakeRedis(): RedisLikeClient {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    scan: vi.fn(async () => ['0', []]),
  };
}

describe('POST /oauth2/token when Redis fails', () => {
  const logs: Record<string, unknown>[] = [];
  let app: ReturnType<typeof Fastify>;
  let redis: RedisLikeClient;
  let metrics: TokenExchangeMetrics;

  beforeEach(async () => {
    logs.length = 0;
    fetchMock.mockReset();
    redis = fakeRedis();
    metrics = {
      recordCacheAccess: vi.fn(),
      recordCacheError: vi.fn(),
      recordUnavailable: vi.fn(),
      recordExchange: vi.fn(),
      recordServedTtl: vi.fn(),
    };
    app = Fastify({
      loggerInstance: pino(
        { level: 'error' },
        {
          write: (line: string) =>
            logs.push(JSON.parse(line) as Record<string, unknown>),
        },
      ),
    });
    const options = { hydraPublicUrl: 'http://hydra.test', redis, metrics };
    await app.register(oauth2GrantCachePlugin, options);
    await app.register(oauth2Routes, options);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function requestToken(
    payload = 'grant_type=client_credentials&client_id=agent&client_secret=secret',
  ) {
    return app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });
  }

  it('reports a failed cache read and never calls Hydra', async () => {
    // Arrange
    vi.mocked(redis.get).mockRejectedValue(new Error('Command timed out'));

    // Act
    const response = await requestToken();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(3);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(7);
    expect(response.json()).toMatchObject({
      error: 'temporarily_unavailable',
    });
    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(metrics.recordCacheError).toHaveBeenCalledWith('rest-proxy', 'get');
    expect(metrics.recordUnavailable).toHaveBeenCalledWith(
      'rest-proxy',
      'client_credentials',
    );
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'rest-proxy',
      'error',
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cacheOperation: 'get',
          failureKind: 'oauth2_grant_cache_unavailable',
          upstreamMinted: false,
        }),
      ]),
    );
    expect(JSON.stringify(logs)).not.toContain('client_secret');
  });

  it('forwards a grant outside the cache policy without reading Redis', async () => {
    // Arrange
    vi.mocked(redis.get).mockRejectedValue(new Error('Command timed out'));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'authorization-token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    // Act
    const response = await requestToken(
      'grant_type=authorization_code&code=code&client_id=agent',
    );

    // Assert
    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('calls Hydra after a retry returns an empty cache response', async () => {
    // Arrange
    vi.mocked(redis.get)
      .mockRejectedValueOnce(new Error('Command timed out'))
      .mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        access_token: 'minted-token',
        token_type: 'bearer',
        expires_in: 3600,
      }),
      headers: new Headers(),
    });

    // Act
    const response = await requestToken();

    // Assert
    expect(response.statusCode).toBe(200);
    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('delivers a minted token when only the cache write fails', async () => {
    // Arrange
    vi.mocked(redis.set).mockRejectedValue(new Error('Command timed out'));
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        access_token: 'minted-token',
        token_type: 'bearer',
        expires_in: 3600,
      }),
      headers: new Headers(),
    });

    // Act
    const response = await requestToken();

    // Assert
    expect(response.statusCode).toBe(200);
    expect(response.json().access_token).toBe('minted-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cacheOperation: 'set',
          failureKind: 'oauth2_grant_cache_unavailable',
          upstreamMinted: true,
        }),
      ]),
    );
  });

  it('shares one minted token, then blocks new mints until Redis accepts a write', async () => {
    // Arrange
    vi.mocked(redis.set).mockRejectedValue(new Error('Command timed out'));
    let releaseFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    fetchMock.mockReturnValueOnce(pendingFetch);

    // Act
    const firstRequest = requestToken();
    const secondRequest = requestToken();
    await vi.waitFor(() =>
      expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
        'rest-proxy',
        'single_flight',
      ),
    );
    releaseFetch(
      new Response(
        JSON.stringify({
          access_token: 'shared-token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    const duringWriteFailure = await requestToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.mocked(redis.set).mockResolvedValue('OK');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'recovered-token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const afterRecovery = await requestToken();

    // Assert
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(duringWriteFailure.statusCode).toBe(503);
    expect(afterRecovery.statusCode).toBe(200);
    expect(first.json().access_token).toBe('shared-token');
    expect(second.json().access_token).toBe('shared-token');
    expect(afterRecovery.json().access_token).toBe('recovered-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledTimes(6);
    expect(vi.mocked(redis.set).mock.calls[2]?.[0]).toBe(
      'moltnet:oauth-token:__write-probe__',
    );
    expect(metrics.recordUnavailable).toHaveBeenCalledWith(
      'rest-proxy',
      'client_credentials',
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cacheOperation: 'set',
          failureKind: 'oauth2_grant_cache_unavailable',
          upstreamMinted: true,
        }),
      ]),
    );
  });

  it('mints after an expired cache entry cannot be deleted', async () => {
    // Arrange
    vi.mocked(redis.get).mockResolvedValue(
      JSON.stringify({
        value: { status: 200, body: { access_token: 'expired' }, headers: {} },
        expiresAt: Date.now() - 1,
      }),
    );
    vi.mocked(redis.del).mockRejectedValue(new Error('Command timed out'));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'fresh-token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    // Act
    const response = await requestToken();

    // Assert
    expect(response.statusCode).toBe(200);
    expect(response.json().access_token).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(redis.del).toHaveBeenCalledTimes(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cacheOperation: 'delete',
          failureKind: 'oauth2_grant_cache_unavailable',
        }),
      ]),
    );
  });
});
