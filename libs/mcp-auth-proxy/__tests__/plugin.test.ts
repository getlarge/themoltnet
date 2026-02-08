import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { mcpAuthProxyPlugin } from '../src/plugin.js';

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

const TOKEN_ENDPOINT = 'https://hydra.example.com/oauth2/token';

describe('mcpAuthProxyPlugin', () => {
  let app: FastifyInstance;
  let fetchSpy: Mock;

  async function buildApp(
    pluginOpts: Parameters<typeof mcpAuthProxyPlugin>[1] = {
      tokenEndpoint: TOKEN_ENDPOINT,
      scopes: ['moltnet:read'],
    },
  ): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    await app.register(mcpAuthProxyPlugin, pluginOpts);

    app.get('/test', async (request) => ({
      authorization: request.headers.authorization ?? null,
      clientId: request.headers['x-client-id'] ?? null,
      clientSecret: request.headers['x-client-secret'] ?? null,
    }));

    return app;
  }

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('should exchange client credentials and inject Bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(mockTokenResponse('my-token'));
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.authorization).toBe('Bearer my-token');
    expect(body.clientId).toBeNull();
    expect(body.clientSecret).toBeNull();
  });

  it('should passthrough when Authorization header is already present', async () => {
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer existing-token' },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.authorization).toBe('Bearer existing-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should passthrough when no credentials are provided', async () => {
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.authorization).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should passthrough when only client-id is provided (partial)', async () => {
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-client-id': 'agent-1' },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.authorization).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return 401 when Hydra rejects credentials', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ error: 'invalid_client' }, 401, false),
    );
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'bad-agent',
        'x-client-secret': 'bad-secret',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('should return 502 when token endpoint is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));
    await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBe('BAD_GATEWAY');
  });

  it('should reuse cached token across requests', async () => {
    fetchSpy.mockResolvedValueOnce(mockTokenResponse('cached-token', 3600));
    await buildApp();

    // First request — triggers exchange
    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    // Second request — should use cache
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    expect(res.json().authorization).toBe('Bearer cached-token');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('should re-exchange when cached token expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    fetchSpy.mockResolvedValueOnce(mockTokenResponse('first-token', 60));
    await buildApp({ tokenEndpoint: TOKEN_ENDPOINT, scopes: ['moltnet:read'] });

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    // Advance past expiry (60s token - 30s buffer = 30s effective)
    vi.advanceTimersByTime(31_000);
    vi.setSystemTime(1_031_000);

    fetchSpy.mockResolvedValueOnce(mockTokenResponse('second-token', 3600));

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    expect(res.json().authorization).toBe('Bearer second-token');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should support custom header names', async () => {
    fetchSpy.mockResolvedValueOnce(mockTokenResponse('custom-token'));
    await buildApp({
      tokenEndpoint: TOKEN_ENDPOINT,
      scopes: ['moltnet:read'],
      clientHeaderNames: {
        clientId: 'X-Agent-Id',
        clientSecret: 'X-Agent-Secret',
      },
    });

    app.get('/custom', async (request) => ({
      authorization: request.headers.authorization ?? null,
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/custom',
      headers: {
        'x-agent-id': 'agent-1',
        'x-agent-secret': 'secret-1',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().authorization).toBe('Bearer custom-token');
  });

  it('should rate limit after repeated failures', async () => {
    await buildApp({
      tokenEndpoint: TOKEN_ENDPOINT,
      scopes: ['moltnet:read'],
      rateLimit: { maxFailures: 2, cooldownMs: 60_000 },
    });

    // 2 failures
    for (let i = 0; i < 2; i++) {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ error: 'invalid_client' }, 401, false),
      );
      await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-client-id': 'bad-agent',
          'x-client-secret': 'bad-secret',
        },
      });
    }

    // 3rd request should be rate limited without calling fetch
    fetchSpy.mockClear();
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'bad-agent',
        'x-client-secret': 'bad-secret',
      },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('RATE_LIMITED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should discover token endpoint via OIDC at startup', async () => {
    // First call: OIDC discovery. Subsequent calls: token exchange.
    fetchSpy
      .mockResolvedValueOnce(
        mockFetchResponse({
          token_endpoint: TOKEN_ENDPOINT,
          issuer: 'https://hydra.example.com/',
        }),
      )
      .mockResolvedValueOnce(mockTokenResponse('discovered-token'));

    await buildApp({
      oidcDiscoveryUrl:
        'https://hydra.example.com/.well-known/openid-configuration',
      scopes: ['moltnet:read'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-client-id': 'agent-1',
        'x-client-secret': 'secret-1',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().authorization).toBe('Bearer discovered-token');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should fail registration when OIDC discovery fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const badApp = Fastify({ logger: false });
    await expect(
      badApp.register(mcpAuthProxyPlugin, {
        oidcDiscoveryUrl:
          'https://bad.example.com/.well-known/openid-configuration',
        scopes: ['moltnet:read'],
      }),
    ).rejects.toThrow();

    await badApp.close();
  });

  it('should fail registration without tokenEndpoint or oidcDiscoveryUrl', async () => {
    const badApp = Fastify({ logger: false });
    await expect(
      badApp.register(mcpAuthProxyPlugin, {
        scopes: ['moltnet:read'],
      }),
    ).rejects.toThrow(
      'either tokenEndpoint or oidcDiscoveryUrl must be provided',
    );

    await badApp.close();
  });

  it('should close cleanly without hanging', async () => {
    await buildApp();
    await expect(app.close()).resolves.toBeUndefined();
  });
});
