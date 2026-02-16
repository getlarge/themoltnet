import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

describe('POST /oauth2/token', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await app.close();
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

  it('rejects non-client_credentials grant_type with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=authorization_code&code=abc',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.detail).toContain('authorization_code');
    expect(body.detail).toContain('client_credentials');

    // Should NOT have called Hydra
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing grant_type with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=test-id&client_secret=test-secret',
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('returns 502 when Hydra is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'grant_type=client_credentials&client_id=test-id&client_secret=test-secret',
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.code).toBe('UPSTREAM_ERROR');
  });
});
