import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, NetworkError } from '../src/errors.js';
import { TokenManager } from '../src/token.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tokenResponse(access_token: string, expires_in: number, status = 200) {
  return new Response(
    JSON.stringify({ access_token, token_type: 'bearer', expires_in }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(error: string, status: number) {
  return new Response(JSON.stringify({ error, error_description: error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TokenManager', () => {
  const opts = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    apiUrl: 'https://api.themolt.net',
  };

  it('should obtain a token on first getToken() call', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    const token = await tm.getToken();
    expect(token).toBe('tok-1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should cache the token on subsequent calls', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    await tm.getToken();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should re-fetch when token is expired', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 0))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager({ ...opts, expiryBufferMs: 0 });
    await tm.getToken();
    const token = await tm.getToken();
    expect(token).toBe('tok-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should send form-encoded client_credentials request', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.themolt.net/oauth2/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('test-client');
    expect(body.get('client_secret')).toBe('test-secret');
  });

  it('should throw AuthenticationError on 401', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse('invalid_client', 401));
    const tm = new TokenManager(opts);
    await expect(tm.getToken()).rejects.toThrow(AuthenticationError);
  });

  it('should throw NetworkError on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const tm = new TokenManager(opts);
    await expect(tm.getToken()).rejects.toThrow(NetworkError);
  });

  it('should invalidate cached token', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    tm.invalidate();
    const token = await tm.getToken();
    expect(token).toBe('tok-2');
  });

  it('authenticate() should force-fetch even with cached token', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const tm = new TokenManager(opts);
    await tm.getToken();
    const token = await tm.authenticate();
    expect(token).toBe('tok-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
