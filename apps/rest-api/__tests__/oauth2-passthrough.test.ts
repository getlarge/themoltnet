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

function upstream(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(headers),
  };
}

function tokenBody(accessToken = 'tok', extra: Record<string, unknown> = {}) {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    ...extra,
  };
}

async function post(
  app: FastifyInstance,
  payload: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/oauth2/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams(payload).toString(),
  });
}

function lastUpstreamCall() {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit & {
    headers: Record<string, string>;
  };
}

describe('POST /oauth2/token passthrough', () => {
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

  it('forwards authorization_code instead of rejecting it locally', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream(tokenBody('auth-code-tok')));

    // Act
    const res = await post(app, {
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost/cb',
      client_id: 'c-code',
    });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBe('auth-code-tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards a grant type it has never heard of', async () => {
    // Arrange — Hydra stays the authority on what is valid
    fetchMock.mockResolvedValueOnce(
      upstream({ error: 'unsupported_grant_type' }, 400),
    );

    // Act
    const res = await post(app, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unsupported_grant_type');
  });

  it('forwards the Authorization header for client_secret_basic', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream(tokenBody()));
    const basic = `Basic ${Buffer.from('id:secret').toString('base64')}`;

    // Act
    await post(
      app,
      { grant_type: 'client_credentials' },
      { authorization: basic },
    );

    // Assert
    expect(lastUpstreamCall().headers.Authorization).toBe(basic);
  });

  it('forwards the DPoP header', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream(tokenBody()));

    // Act
    await post(
      app,
      { grant_type: 'client_credentials', client_id: 'c-dpop' },
      { dpop: 'proof-jwt' },
    );

    // Assert
    expect(lastUpstreamCall().headers.DPoP).toBe('proof-jwt');
  });

  it('returns DPoP-Nonce and WWW-Authenticate from upstream', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(
      upstream({ error: 'use_dpop_nonce' }, 400, {
        'DPoP-Nonce': 'nonce-abc',
        'WWW-Authenticate': 'DPoP error="use_dpop_nonce"',
      }),
    );

    // Act
    const res = await post(app, {
      grant_type: 'client_credentials',
      client_id: 'c-nonce',
    });

    // Assert
    expect(res.headers['dpop-nonce']).toBe('nonce-abc');
    expect(res.headers['www-authenticate']).toBe('DPoP error="use_dpop_nonce"');
  });

  it('passes through a status outside the original 200/400/401 set', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(
      upstream({ error: 'too_many_requests' }, 429),
    );

    // Act
    const res = await post(app, {
      grant_type: 'client_credentials',
      client_id: 'c-429',
    });

    // Assert
    expect(res.statusCode).toBe(429);
  });

  it('does not strip error fields the schema never enumerated', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(
      upstream(
        { error: 'invalid_grant', error_uri: 'https://ory/docs', custom: 'x' },
        400,
      ),
    );

    // Act
    const res = await post(app, {
      grant_type: 'client_credentials',
      client_id: 'c-strip',
    });

    // Assert — a proxy must not rewrite the upstream body
    expect(res.json().error_uri).toBe('https://ory/docs');
    expect(res.json().custom).toBe('x');
  });

  it('treats clients differing only by Authorization header as distinct', async () => {
    // Arrange — under client_secret_basic the identity is in the header, so a
    // body-only cache key would serve one client another's token.
    fetchMock
      .mockResolvedValueOnce(upstream(tokenBody('tok-alice')))
      .mockResolvedValueOnce(upstream(tokenBody('tok-bob')));
    const alice = `Basic ${Buffer.from('alice:pw').toString('base64')}`;
    const bob = `Basic ${Buffer.from('bob:pw').toString('base64')}`;

    // Act
    const a = await post(app, { grant_type: 'client_credentials' }, { authorization: alice });
    const b = await post(app, { grant_type: 'client_credentials' }, { authorization: bob });

    // Assert
    expect(a.json().access_token).toBe('tok-alice');
    expect(b.json().access_token).toBe('tok-bob');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /oauth2/token grant cache policy', () => {
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

  it('never caches authorization_code — reuse detection must stay with Hydra', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(upstream(tokenBody('first')))
      .mockResolvedValueOnce(upstream({ error: 'invalid_grant' }, 400));

    // Act — the same code twice
    const first = await post(app, {
      grant_type: 'authorization_code',
      code: 'single-use',
      client_id: 'c-reuse',
    });
    const replay = await post(app, {
      grant_type: 'authorization_code',
      code: 'single-use',
      client_id: 'c-reuse',
    });

    // Assert — the replay must reach Hydra and be rejected, not be served
    // from our cache
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches a refresh_token grant and returns the token unrotated', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(
      upstream(tokenBody('rt-access', { refresh_token: 'RT-1' })),
    );

    // Act
    const first = await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-1',
      client_id: 'c-refresh',
    });
    const second = await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-1',
      client_id: 'c-refresh',
    });

    // Assert — one upstream call, and the client keeps a refresh token that
    // is still valid at Hydra precisely because we never redeemed it
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.json().access_token).toBe('rt-access');
    expect(second.json().refresh_token).toBe('RT-1');
    expect(first.json().refresh_token).toBe('RT-1');
  });

  it('does not serve a cached grant to a different refresh token', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(upstream(tokenBody('access-1')))
      .mockResolvedValueOnce(upstream(tokenBody('access-2')));

    // Act
    const a = await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-A',
      client_id: 'c-two-rt',
    });
    const b = await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-B',
      client_id: 'c-two-rt',
    });

    // Assert
    expect(a.json().access_token).toBe('access-1');
    expect(b.json().access_token).toBe('access-2');
  });

  it('caps refresh_token caching well below the token lifetime', async () => {
    // Arrange — upstream says 3600s; policy caps the cached window at 60s
    fetchMock.mockResolvedValueOnce(
      upstream(tokenBody('capped', { refresh_token: 'RT-CAP' })),
    );
    await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-CAP',
      client_id: 'c-cap',
    });

    // Act
    const cached = await post(app, {
      grant_type: 'refresh_token',
      refresh_token: 'RT-CAP',
      client_id: 'c-cap',
    });

    // Assert — remaining life reflects the 60s cap, not 3600
    expect(cached.json().expires_in).toBeLessThanOrEqual(30);
  });
});
