import type { RedisLikeClient } from '@moltnet/oauth-token-cache';
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

  beforeEach(async () => {
    logs.length = 0;
    fetchMock.mockReset();
    redis = fakeRedis();
    app = Fastify({
      loggerInstance: pino(
        { level: 'error' },
        {
          write: (line: string) =>
            logs.push(JSON.parse(line) as Record<string, unknown>),
        },
      ),
    });
    const options = { hydraPublicUrl: 'http://hydra.test', redis };
    await app.register(oauth2GrantCachePlugin, options);
    await app.register(oauth2Routes, options);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function requestToken() {
    return app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=agent&client_secret=secret',
    });
  }

  it('reports a failed cache read and never calls Hydra', async () => {
    // Arrange
    vi.mocked(redis.get).mockRejectedValue(new Error('Command timed out'));

    // Act
    const response = await requestToken();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toMatchObject({
      error: 'temporarily_unavailable',
    });
    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
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
});
