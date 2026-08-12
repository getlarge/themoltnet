import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheStore } from '../src/cache/memory.js';
import type { TokenExchangeMetrics } from '../src/metrics.js';
import {
  createTokenExchanger,
  type TokenExchangeLogger,
  type TokenExchanger,
} from '../src/token-exchange.js';

function mockLogger(): TokenExchangeLogger {
  return { debug: vi.fn() };
}

function mockMetrics(): TokenExchangeMetrics {
  return {
    recordCacheAccess: vi.fn(),
    recordExchange: vi.fn(),
    recordServedTtl: vi.fn(),
  };
}

function mockFetchResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function tokenResponse(accessToken = 'tok', expiresIn = 3600): Response {
  return mockFetchResponse({
    access_token: accessToken,
    expires_in: expiresIn,
    token_type: 'Bearer',
  });
}

describe('token exchange metrics', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let metrics: TokenExchangeMetrics;
  let exchanger: TokenExchanger;

  function makeExchanger(source = 'rest-proxy'): TokenExchanger {
    return createTokenExchanger({
      tokenEndpoint: 'https://hydra.example.com/oauth2/token',
      scopes: ['diary:read'],
      expiryBufferSeconds: 30,
      cache: new MemoryCacheStore<string>(),
      rateLimit: { maxFailures: 5, cooldownMs: 60_000 },
      log: mockLogger(),
      metrics,
      source,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    metrics = mockMetrics();
  });

  afterEach(() => {
    exchanger?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records a miss and a successful upstream exchange on first call', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    exchanger = makeExchanger();

    // Act
    await exchanger.exchange('client-a', 'secret-a');

    // Assert
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'rest-proxy',
      'miss',
    );
    expect(metrics.recordExchange).toHaveBeenCalledWith(
      'rest-proxy',
      'client_credentials',
      'success',
    );
  });

  it('records a hit and no upstream exchange when the token is cached', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    exchanger = makeExchanger();
    await exchanger.exchange('client-a', 'secret-a');
    vi.mocked(metrics.recordExchange).mockClear();

    // Act
    await exchanger.exchange('client-a', 'secret-a');

    // Assert
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith('rest-proxy', 'hit');
    expect(metrics.recordExchange).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('records remaining TTL when serving from cache', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(tokenResponse('tok', 3600));
    exchanger = makeExchanger();
    await exchanger.exchange('client-a', 'secret-a');
    vi.advanceTimersByTime(600_000); // 10 minutes

    // Act
    await exchanger.exchange('client-a', 'secret-a');

    // Assert — 3600s lifetime, 30s buffer, 600s elapsed => 2970s remaining
    expect(metrics.recordServedTtl).toHaveBeenCalledWith('rest-proxy', 2970);
  });

  it('records single_flight for concurrent requests on the same credentials', async () => {
    // Arrange
    let release: (value: Response) => void = () => undefined;
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    exchanger = makeExchanger();

    // Act
    const first = exchanger.exchange('client-a', 'secret-a');
    const second = exchanger.exchange('client-a', 'secret-a');
    release(tokenResponse());
    await Promise.all([first, second]);

    // Assert
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'rest-proxy',
      'single_flight',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('records an invalid outcome when the endpoint rejects the credentials', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 401, false));
    exchanger = makeExchanger();

    // Act
    await expect(exchanger.exchange('client-a', 'bad')).rejects.toThrow();

    // Assert
    expect(metrics.recordExchange).toHaveBeenCalledWith(
      'rest-proxy',
      'client_credentials',
      'invalid',
    );
  });

  it('records an unavailable outcome when the endpoint is unreachable', async () => {
    // Arrange
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    exchanger = makeExchanger();

    // Act
    await expect(exchanger.exchange('client-a', 'secret-a')).rejects.toThrow();

    // Assert
    expect(metrics.recordExchange).toHaveBeenCalledWith(
      'rest-proxy',
      'client_credentials',
      'unavailable',
    );
  });

  it('tags metrics with the configured source so callers stay distinguishable', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    exchanger = makeExchanger('mcp-proxy');

    // Act
    await exchanger.exchange('client-a', 'secret-a');

    // Assert
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith('mcp-proxy', 'miss');
    expect(metrics.recordExchange).toHaveBeenCalledWith(
      'mcp-proxy',
      'client_credentials',
      'success',
    );
  });

  it('works without metrics configured', async () => {
    // Arrange
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    exchanger = createTokenExchanger({
      tokenEndpoint: 'https://hydra.example.com/oauth2/token',
      scopes: ['diary:read'],
      expiryBufferSeconds: 30,
      cache: new MemoryCacheStore<string>(),
      rateLimit: { maxFailures: 5, cooldownMs: 60_000 },
      log: mockLogger(),
    });

    // Act + Assert
    await expect(exchanger.exchange('client-a', 'secret-a')).resolves.toBe(
      'tok',
    );
  });
});
