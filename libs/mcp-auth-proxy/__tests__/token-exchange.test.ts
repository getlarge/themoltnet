import type { FastifyBaseLogger } from 'fastify';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { MemoryTokenCache } from '../src/cache/memory.js';
import type { TokenCache } from '../src/cache/types.js';
import {
  createTokenExchanger,
  discoverTokenEndpoint,
  type TokenExchanger,
} from '../src/token-exchange.js';

function mockLogger(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'debug',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function mockFetchResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => ({}) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(''),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

describe('discoverTokenEndpoint', () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the token_endpoint from discovery doc', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        token_endpoint: 'https://hydra.example.com/oauth2/token',
        issuer: 'https://hydra.example.com/',
      }),
    );

    const endpoint = await discoverTokenEndpoint(
      'https://hydra.example.com/.well-known/openid-configuration',
    );

    expect(endpoint).toBe('https://hydra.example.com/oauth2/token');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hydra.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should throw on network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('DNS resolution failed'));

    await expect(
      discoverTokenEndpoint(
        'https://bad.example.com/.well-known/openid-configuration',
      ),
    ).rejects.toThrow('OIDC discovery failed');
  });

  it('should throw on non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 404, false));

    await expect(
      discoverTokenEndpoint(
        'https://hydra.example.com/.well-known/openid-configuration',
      ),
    ).rejects.toThrow('OIDC discovery returned HTTP 404');
  });

  it('should throw when token_endpoint is missing', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ issuer: 'https://hydra.example.com/' }),
    );

    await expect(
      discoverTokenEndpoint(
        'https://hydra.example.com/.well-known/openid-configuration',
      ),
    ).rejects.toThrow('missing token_endpoint');
  });
});

describe('createTokenExchanger', () => {
  let fetchSpy: Mock;
  let cache: TokenCache;
  let log: FastifyBaseLogger;
  let exchanger: TokenExchanger;

  const TOKEN_ENDPOINT = 'https://hydra.example.com/oauth2/token';

  function makeExchanger(
    overrides: Partial<Parameters<typeof createTokenExchanger>[0]> = {},
  ): TokenExchanger {
    return createTokenExchanger({
      tokenEndpoint: TOKEN_ENDPOINT,
      scopes: ['moltnet:read', 'moltnet:write'],
      expiryBufferSeconds: 30,
      cache,
      rateLimit: { maxFailures: 5, cooldownMs: 60_000 },
      log,
      ...overrides,
    });
  }

  function mockTokenResponse(
    accessToken = 'access-token-abc',
    expiresIn = 3600,
  ): Response {
    return mockFetchResponse({
      access_token: accessToken,
      expires_in: expiresIn,
      token_type: 'Bearer',
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    cache = new MemoryTokenCache();
    log = mockLogger();
  });

  afterEach(() => {
    exchanger?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should exchange credentials for a token', async () => {
    fetchSpy.mockResolvedValueOnce(mockTokenResponse());
    exchanger = makeExchanger();

    const token = await exchanger.exchange('client-1', 'secret-1');

    expect(token).toBe('access-token-abc');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('should send correct request body format', async () => {
    fetchSpy.mockResolvedValueOnce(mockTokenResponse());
    exchanger = makeExchanger({ audience: 'https://api.themolt.net' });

    await exchanger.exchange('client-1', 'secret-1');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('secret-1');
    expect(body.get('scope')).toBe('moltnet:read moltnet:write');
    expect(body.get('audience')).toBe('https://api.themolt.net');
  });

  it('should throw 401 on Hydra 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ error: 'invalid_client' }, 401, false),
    );
    exchanger = makeExchanger();

    await expect(
      exchanger.exchange('bad-client', 'bad-secret'),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('should throw 401 on Hydra 400', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ error: 'invalid_request' }, 400, false),
    );
    exchanger = makeExchanger();

    await expect(
      exchanger.exchange('bad-client', 'bad-secret'),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('should throw 502 on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));
    exchanger = makeExchanger();

    await expect(
      exchanger.exchange('client-1', 'secret-1'),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'BAD_GATEWAY',
    });
  });

  it('should throw 502 on Hydra 500', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ error: 'server_error' }, 500, false),
    );
    exchanger = makeExchanger();

    await expect(
      exchanger.exchange('client-1', 'secret-1'),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'BAD_GATEWAY',
    });
  });

  it('should return cached token without calling fetch', async () => {
    await cache.set('client-1', {
      token: 'cached-token',
      expiresAt: 2_000_000,
    });
    exchanger = makeExchanger();

    const token = await exchanger.exchange('client-1', 'secret-1');

    expect(token).toBe('cached-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should re-exchange when cache is expired', async () => {
    await cache.set('client-1', {
      token: 'old-token',
      expiresAt: 500_000,
    });
    fetchSpy.mockResolvedValueOnce(mockTokenResponse('fresh-token'));
    exchanger = makeExchanger();

    const token = await exchanger.exchange('client-1', 'secret-1');

    expect(token).toBe('fresh-token');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('should deduplicate concurrent exchanges for the same client', async () => {
    let resolveExchange: (v: Response) => void;
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveExchange = resolve;
      }),
    );
    exchanger = makeExchanger();

    const p1 = exchanger.exchange('client-1', 'secret-1');
    const p2 = exchanger.exchange('client-1', 'secret-1');

    resolveExchange!(mockTokenResponse('deduped-token'));

    const [t1, t2] = await Promise.all([p1, p2]);

    expect(t1).toBe('deduped-token');
    expect(t2).toBe('deduped-token');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('should rate limit after max failures', async () => {
    exchanger = makeExchanger({
      rateLimit: { maxFailures: 3, cooldownMs: 60_000 },
    });

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ error: 'invalid_client' }, 401, false),
      );
      await expect(
        exchanger.exchange('client-1', 'bad-secret'),
      ).rejects.toMatchObject({ statusCode: 401 });
    }

    // 4th call should be rate limited without calling fetch
    fetchSpy.mockClear();
    await expect(
      exchanger.exchange('client-1', 'bad-secret'),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should reset rate limit after cooldown and successful exchange', async () => {
    exchanger = makeExchanger({
      rateLimit: { maxFailures: 2, cooldownMs: 10_000 },
    });

    // 2 failures → rate limited
    for (let i = 0; i < 2; i++) {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ error: 'invalid_client' }, 401, false),
      );
      await expect(exchanger.exchange('client-1', 'bad')).rejects.toMatchObject(
        { statusCode: 401 },
      );
    }

    // Advance past cooldown
    vi.advanceTimersByTime(11_000);
    vi.setSystemTime(1_011_000);

    // Successful exchange resets
    fetchSpy.mockResolvedValueOnce(mockTokenResponse('recovered-token'));
    const token = await exchanger.exchange('client-1', 'good-secret');

    expect(token).toBe('recovered-token');
  });
});
