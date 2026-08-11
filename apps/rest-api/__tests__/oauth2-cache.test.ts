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

async function post(app: FastifyInstance, payload: string) {
  return app.inject({
    method: 'POST',
    url: '/oauth2/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload,
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
