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

describe('POST /oauth2/token', () => {
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

  it('proxies a valid client_credentials grant and returns 200', async () => {
    const tokenPayload = {
      access_token: 'mock-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'diary:read diary:write',
    };

    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => tokenPayload,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=test-id&client_secret=test-secret',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject(tokenPayload);

    // Verify fetch was called with correct upstream URL
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hydra-mock:4444/oauth2/token');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });

  // Contract change: this endpoint no longer gates grant types locally. It is
  // advertised as the token endpoint, so an allowlist here would silently
  // break any grant Hydra gains later — Hydra decides what is valid and its
  // rejection is forwarded verbatim.
  it('forwards a non-client_credentials grant to Hydra rather than rejecting it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'unsupported_grant_type',
          error_description: 'from Hydra',
        }),
      headers: new Headers(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=authorization_code&code=abc',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(400);
    expect(response.json().error_description).toBe('from Hydra');
  });

  it('forwards a request with no grant_type to Hydra', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_request' }),
      headers: new Headers(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=nogrant-id&client_secret=nogrant-secret',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');
  });

  it('forwards Hydra 401 for invalid credentials', async () => {
    const errorPayload = {
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    };

    fetchMock.mockResolvedValueOnce({
      status: 401,
      json: async () => errorPayload,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=bad-id&client_secret=bad-secret',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject(errorPayload);
  });

  // Distinct credentials per test: the proxy caches successful grants, so
  // reusing the ids from the happy-path test above would serve from cache and
  // never reach the upstream-failure path these tests exercise.
  it('returns 502 when Hydra returns invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=badjson-id&client_secret=badjson-secret',
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.code).toBe('UPSTREAM_ERROR');
  });

  it('returns 502 when Hydra is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=unreach-id&client_secret=unreach-secret',
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.code).toBe('UPSTREAM_ERROR');
  });
});
