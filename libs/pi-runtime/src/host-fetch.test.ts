import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFixedOriginHostFetch,
  FixedOriginHostFetchError,
  redactLiteralSecrets,
} from './host-fetch.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createFixedOriginHostFetch', () => {
  it('accepts only origin-relative paths on the configured HTTP(S) origin', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('ok'));
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: fetchImpl,
    });

    await expect(request('/v1/items?limit=1')).resolves.toHaveProperty(
      'status',
      200,
    );
    const call = fetchImpl.mock.calls.at(0);
    expect(call).toBeDefined();
    const [url, init] = call ?? [];
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error('expected URL request input');
    expect(url.href).toBe('https://api.example.com/v1/items?limit=1');
    expect(init).toMatchObject({ redirect: 'manual' });

    for (const path of [
      'v1/items',
      'https://other.example/items',
      '//other.example/items',
      '/items#fragment',
      '/items\\other',
    ]) {
      await expect(request(path)).rejects.toMatchObject({
        code: 'invalid_path',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    'ftp://api.example.com',
    'https://user:secret@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com/?query=1',
  ])('rejects non-origin configuration %s', (origin) => {
    expect(() => createFixedOriginHostFetch({ origin })).toThrow(
      expect.objectContaining({ code: 'invalid_origin' }),
    );
  });

  it('rejects redirect responses even when an injected fetch returns one', async () => {
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://other.example.com' },
        }),
      ),
    });

    await expect(request('/redirect')).rejects.toMatchObject({
      code: 'redirect_rejected',
    });
  });

  it('accepts a non-redirect 304 and rejects followed or cross-origin responses', async () => {
    const notModified = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 304 })),
    });
    await expect(notModified('/cached')).resolves.toMatchObject({
      status: 304,
    });

    for (const { redirected, url } of [
      { redirected: true, url: 'https://api.example.com/final' },
      { redirected: false, url: 'https://other.example.com/final' },
    ]) {
      const response = new Response('unexpected');
      Object.defineProperties(response, {
        redirected: { value: redirected },
        url: { value: url },
      });
      const request = createFixedOriginHostFetch({
        origin: 'https://api.example.com',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      });
      await expect(request('/start')).rejects.toMatchObject({
        code: 'redirect_rejected',
      });
    }
  });

  it('validates constructor and request bounds', async () => {
    for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createFixedOriginHostFetch({
          origin: 'https://api.example.com',
          timeoutMs,
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_timeout' }));
    }
    for (const maxResponseBytes of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createFixedOriginHostFetch({
          origin: 'https://api.example.com',
          maxResponseBytes,
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_response_limit' }));
    }

    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('ok')),
    });
    await expect(request('/items', { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'invalid_timeout',
    });
    await expect(
      request('/items', { maxResponseBytes: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_response_limit' });
  });

  it('honors caller cancellation before and during the request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: fetchImpl,
    });
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();

    await expect(
      request('/items', { signal: alreadyCancelled.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const active = new AbortController();
    const pending = request('/items', { signal: active.signal });
    active.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('applies a deadline to the injected fetch', async () => {
    vi.useFakeTimers();
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      timeoutMs: 50,
      fetch: vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    });

    const pending = request('/slow');
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('clamps request deadlines to the configured ceiling', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      timeoutMs: 50,
      fetch: fetchImpl,
    });

    const narrower = request('/narrower', { timeoutMs: 20 });
    const narrowerAssertion = expect(narrower).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(20);
    await narrowerAssertion;

    const wider = request('/wider', { timeoutMs: 500 });
    const widerAssertion = expect(wider).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(50);
    await widerAssertion;
  });

  it('cancels a response that arrives after the deadline', async () => {
    vi.useFakeTimers();
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      timeoutMs: 10,
      fetch: fetchImpl,
    });
    const pending = request('/late');
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    const cancel = vi.fn().mockResolvedValue(undefined);
    const late = new Response('late');
    Object.defineProperty(late, 'body', {
      value: { cancel },
    });
    resolveFetch?.(late);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('applies the deadline while reading a response body', async () => {
    vi.useFakeTimers();
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      timeoutMs: 50,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull: () =>
              new Promise<void>(() => {
                // Intentionally pending: the helper deadline must abort the read.
              }),
          }),
        ),
      ),
    });

    const pending = request('/slow-body');
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('bounds declared and streamed response bodies', async () => {
    const declared = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      maxResponseBytes: 4,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('x', {
          headers: { 'content-length': '5' },
        }),
      ),
    });
    await expect(declared('/items')).rejects.toMatchObject({
      code: 'response_too_large',
    });

    const streamed = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      maxResponseBytes: 4,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4, 5]))),
    });
    await expect(streamed('/items')).rejects.toMatchObject({
      code: 'response_too_large',
    });
  });

  it('accepts bodies exactly at the ceiling and clamps request size overrides', async () => {
    for (const response of [
      new Response('four', { headers: { 'content-length': '4' } }),
      new Response(new Uint8Array([1, 2, 3, 4])),
    ]) {
      const request = createFixedOriginHostFetch({
        origin: 'https://api.example.com',
        maxResponseBytes: 4,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      });
      await expect(request('/items')).resolves.toHaveProperty('status', 200);
    }

    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      maxResponseBytes: 4,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('12345')),
    });
    await expect(
      request('/items', { maxResponseBytes: 40 }),
    ).rejects.toMatchObject({
      code: 'response_too_large',
      details: { responseLimit: 4 },
    });
  });

  it('returns promptly when a hostile stream ignores cancellation', async () => {
    vi.useFakeTimers();
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      timeoutMs: 10,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull: () =>
              new Promise<void>(() => {
                // Intentionally never settles.
              }),
            cancel: () =>
              new Promise<void>(() => {
                // Intentionally never settles.
              }),
          }),
        ),
      ),
    });
    const pending = request('/hostile');
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it('returns a replayable bounded response', async () => {
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      responseHeaders: ['X-Request-Id'],
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"ok":true}', {
          status: 201,
          headers: { 'x-request-id': 'safe-id' },
        }),
      ),
    });

    const response = await request('/items', { method: 'POST' });
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('safe-id');
  });

  it('exposes only explicitly allowed safe response headers', async () => {
    expect(() =>
      createFixedOriginHostFetch({
        origin: 'https://api.example.com',
        responseHeaders: ['set-cookie'],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_response_headers' }));

    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      responseHeaders: ['x-request-id'],
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('ok', {
          headers: {
            'x-request-id': 'safe-id',
            'x-unlisted': 'hidden',
            'set-cookie': 'secret=session',
          },
        }),
      ),
    });
    const response = await request('/items');
    expect([...response.headers]).toEqual([['x-request-id', 'safe-id']]);
  });

  it('uses stable errors without reflecting request or upstream secrets', async () => {
    const sentinel = 'super-secret-token';
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error(`provider leaked ${sentinel}`)),
    });

    let error: unknown;
    try {
      await request(`/items?token=${sentinel}`);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FixedOriginHostFetchError);
    expect(error).toMatchObject({ code: 'network_failure' });
    expect(String(error)).not.toContain(sentinel);
    expect(String(error)).not.toContain('/items');
  });

  it('classifies nested network failures without reflecting their cause', async () => {
    const secret = 'secret-network-host';
    const error = Object.assign(new Error(secret), {
      cause: { code: 'ENOTFOUND', hostname: secret },
    });
    const request = createFixedOriginHostFetch({
      origin: 'https://api.example.com',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(error),
    });

    await expect(request('/items')).rejects.toMatchObject({
      code: 'network_failure',
      retryable: false,
      details: { networkFailureKind: 'dns' },
      message: 'Fixed-origin host request failed',
    });
  });
});

describe('redactLiteralSecrets', () => {
  it('redacts exact long literals longest first and ignores short values', () => {
    expect(
      redactLiteralSecrets('token-ab token token-ab dG9rZW4tYWI=', [
        'short',
        undefined,
        '',
        'token-ab',
      ]),
    ).toBe('[REDACTED] token [REDACTED] dG9rZW4tYWI=');
  });
});
