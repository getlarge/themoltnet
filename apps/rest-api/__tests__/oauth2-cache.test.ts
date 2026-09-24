import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  resetMockServices,
} from './helpers.js';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

function tokenResponse(accessToken = 'tok-1', expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
        scope: 'diary:read',
      }),
  };
}

function form(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'client-a',
    client_secret: 'secret-a',
    scope: 'diary:read',
    ...overrides,
  }).toString();
}

async function post(
  app: FastifyInstance,
  payload: string,
  headers: Record<string, string | string[]> = {},
  remoteAddress?: string,
) {
  return app.inject({
    method: 'POST',
    url: '/oauth2/token',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    payload,
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

describe('POST /oauth2/token caching', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    fetchMock.mockReset();
  });

  it('serves a repeat grant from cache without calling Hydra', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(tokenResponse());

    // Act
    const first = await post(app, form());
    const second = await post(app, form());

    // Assert
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().access_token).toBe('tok-1');
    expect(second.json().access_token).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // No fake timers here: vi.useFakeTimers() deadlocks app.inject, and a test
  // that times out before restoring them poisons every test after it. The
  // 30s expiry buffer is enough to prove expires_in is recomputed rather than
  // echoed, without travelling in time.
  it('recomputes expires_in from remaining lifetime rather than echoing upstream', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-ttl', 3600));
    const fresh = await post(app, form({ client_id: 'client-ttl' }));

    // Act
    const cached = await post(app, form({ client_id: 'client-ttl' }));

    // Assert — upstream said 3600; the cached reply must report less, by at
    // least the expiry buffer, and must not echo the original lifetime.
    expect(fresh.json().expires_in).toBe(3600);
    expect(cached.json().expires_in).toBeLessThanOrEqual(3570);
    expect(cached.json().expires_in).toBeGreaterThan(3500);
  });

  it('does not serve a token minted for different scopes', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-read'))
      .mockResolvedValueOnce(tokenResponse('tok-write'));

    // Act
    const read = await post(app, form({ client_id: 'c-scope' }));
    const write = await post(
      app,
      form({ client_id: 'c-scope', scope: 'diary:write' }),
    );

    // Assert
    expect(read.json().access_token).toBe('tok-read');
    expect(write.json().access_token).toBe('tok-write');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not serve one client a token minted for another', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-a'))
      .mockResolvedValueOnce(tokenResponse('tok-b'));

    // Act
    const a = await post(app, form({ client_id: 'c-one' }));
    const b = await post(app, form({ client_id: 'c-two' }));

    // Assert
    expect(a.json().access_token).toBe('tok-a');
    expect(b.json().access_token).toBe('tok-b');
  });

  it('does not serve a cached token to a different secret for the same client', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-good'))
      .mockResolvedValueOnce(tokenResponse('tok-rotated'));

    // Act
    const first = await post(app, form({ client_id: 'c-rot' }));
    const rotated = await post(
      app,
      form({ client_id: 'c-rot', client_secret: 'rotated' }),
    );

    // Assert
    expect(first.json().access_token).toBe('tok-good');
    expect(rotated.json().access_token).toBe('tok-rotated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches an error response', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid_client' }),
      })
      .mockResolvedValueOnce(tokenResponse('tok-after-retry'));

    // Act
    const rejected = await post(app, form({ client_id: 'c-err' }));
    const retried = await post(app, form({ client_id: 'c-err' }));

    // Assert
    expect(rejected.statusCode).toBe(401);
    expect(retried.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a dedicated token budget before the anonymous limit', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitGlobalAnon: 1,
      rateLimitPreResolveIp: 1,
      rateLimitTokenIp: 3,
    });
    fetchMock.mockResolvedValueOnce(tokenResponse());

    try {
      // Act
      const responses = [];
      for (let n = 0; n < 4; n += 1) {
        responses.push(await post(limitedApp, form()));
      }

      // Assert
      expect(responses.map((response) => response.statusCode)).toEqual([
        200, 200, 200, 429,
      ]);
      expect(responses[3].json()).toMatchObject({
        error: 'temporarily_unavailable',
        status_code: 429,
      });
      expect(responses[3].headers['retry-after']).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await limitedApp.close();
    }
  });

  it('keeps the anonymous API bucket after token traffic', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitGlobalAnon: 1,
      rateLimitTokenIp: 3,
    });
    fetchMock.mockResolvedValueOnce(tokenResponse());

    try {
      // Act
      const token = await post(limitedApp, form());
      const apiRequest = () =>
        limitedApp.inject({
          method: 'POST',
          url: '/tasks',
          headers: { 'content-type': 'application/json' },
          payload: {},
        });
      const firstApi = await apiRequest();
      const secondApi = await apiRequest();

      // Assert
      expect(token.statusCode).toBe(200);
      expect(firstApi.statusCode).toBe(400);
      expect(secondApi.statusCode).toBe(429);
    } finally {
      await limitedApp.close();
    }
  });

  it('separates configured client IPs behind the same proxy address', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitTokenIp: 1,
      rateLimitClientIpHeader: 'x-client-ip',
      rateLimitTrustedProxyCidrs: ['172.16.0.0/12'],
      trustProxy: 1,
    });
    fetchMock.mockResolvedValueOnce(tokenResponse());
    const from = (ip: string) =>
      post(
        limitedApp,
        form(),
        {
          'x-client-ip': ip,
          'x-forwarded-for': `${ip}, 203.0.113.20`,
        },
        '172.16.0.162',
      );

    try {
      // Act
      const first = await from('198.51.100.10');
      const second = await from('198.51.100.11');
      const repeated = await from('198.51.100.10');

      // Assert
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(repeated.statusCode).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await limitedApp.close();
    }
  });

  it('ignores untrusted, missing, malformed and scoped client IP headers', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitTokenIp: 1,
      rateLimitClientIpHeader: 'x-client-ip',
      rateLimitTrustedProxyCidrs: ['172.16.0.0/12'],
      trustProxy: 1,
    });
    fetchMock.mockResolvedValue(tokenResponse());
    const cases = [
      {
        peer: '172.16.1.1',
        first: {},
        second: {},
      },
      {
        peer: '172.16.1.2',
        first: { 'x-client-ip': 'invalid' },
        second: { 'x-client-ip': 'also-invalid' },
      },
      {
        peer: '172.16.1.3',
        first: { 'x-client-ip': 'fe80::1%a' },
        second: { 'x-client-ip': 'fe80::1%b' },
      },
      {
        peer: '172.16.1.4',
        first: { 'x-client-ip': ['198.51.100.1', '198.51.100.2'] },
        second: { 'x-client-ip': ['198.51.100.3', '198.51.100.4'] },
      },
      {
        peer: 'fdaa::1',
        first: {
          'x-client-ip': '198.51.100.2',
          'x-forwarded-for': '198.51.100.2',
        },
        second: {
          'x-client-ip': '198.51.100.3',
          'x-forwarded-for': '198.51.100.3',
        },
      },
    ];

    try {
      for (const { peer, first, second } of cases) {
        // Act
        const accepted = await post(limitedApp, form(), first, peer);
        const limited = await post(limitedApp, form(), second, peer);

        // Assert
        expect(accepted.statusCode).toBe(200);
        expect(limited.statusCode, peer).toBe(429);
      }
    } finally {
      await limitedApp.close();
    }
  });

  it('groups IPv6 token callers by /64', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitTokenIp: 1,
      rateLimitClientIpHeader: 'x-client-ip',
      rateLimitTrustedProxyCidrs: ['172.16.0.0/12'],
    });
    fetchMock.mockResolvedValue(tokenResponse());
    const from = (ip: string) =>
      post(limitedApp, form(), { 'x-client-ip': ip }, '172.16.0.162');

    try {
      // Act
      const first = await from('2001:db8:1:2::1');
      const same64 = await from('2001:db8:1:2::2');

      // Assert
      expect(first.statusCode).toBe(200);
      expect(same64.statusCode).toBe(429);
    } finally {
      await limitedApp.close();
    }
  });

  it('skips eager auth resolution even when a bearer header is present', async () => {
    // Arrange
    const resolveAuth = vi.fn(() => null);
    const tokenApp = await createTestApp(
      mocks,
      null,
      undefined,
      undefined,
      resolveAuth,
    );
    fetchMock.mockResolvedValueOnce(tokenResponse());

    try {
      // Act
      const response = await post(tokenApp, form(), {
        authorization: 'Bearer unexpected-token',
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(resolveAuth).not.toHaveBeenCalled();
    } finally {
      await tokenApp.close();
    }
  });

  it('bounds paid upstream misses separately from cached token requests', async () => {
    // Arrange
    const limitedApp = await createTestApp(mocks, null, {
      rateLimitTokenIp: 1000,
      rateLimitTokenUpstreamIp: 2,
    });
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => ({ error: 'invalid_client' }),
      headers: new Headers(),
    });

    try {
      // Act
      const responses = await Promise.all(
        [1, 2, 3].map((n) =>
          post(limitedApp, form({ client_secret: `wrong-${n}` })),
        ),
      );

      // Assert
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        401, 401, 429,
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await limitedApp.close();
    }
  });

  it('deduplicates concurrent authorization-code grants without Redis caching', async () => {
    // Arrange
    let releaseFetch!: (response: ReturnType<typeof tokenResponse>) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFetch = resolve;
      }),
    );
    const payload = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'client-a',
      code: 'one-use-code',
    }).toString();

    // Act
    const first = post(app, payload);
    const second = post(app, payload);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    releaseFetch(tokenResponse());
    const responses = await Promise.all([first, second]);

    // Assert
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('collapses concurrent identical grants into one upstream call', async () => {
    // Arrange
    let release: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    // Act
    const inFlight = [
      post(app, form({ client_id: 'c-flight' })),
      post(app, form({ client_id: 'c-flight' })),
    ];
    release(tokenResponse('tok-flight'));
    const [first, second] = await Promise.all(inFlight);

    // Assert
    expect(first.json().access_token).toBe('tok-flight');
    expect(second.json().access_token).toBe('tok-flight');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
