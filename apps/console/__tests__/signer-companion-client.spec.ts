// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createSignerCompanionClient } from '../src/signing/companion-client.js';

describe('signer companion client', () => {
  it('never serializes browser credentials or authorization material to loopback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            token: 'process-capability',
            expiresAt: '2030-08-01T12:05:00.000Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            id: 'ceremony-id',
            operation: 'credential-enrollment',
            approvalUrl: 'http://127.0.0.1:17373/ceremonies/ceremony-id',
            expiresAt: '2030-08-01T12:05:00.000Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      );
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: fetchMock,
    });

    await client.connect();
    await client.createCeremony({
      version: 1,
      operation: 'credential-enrollment',
      label: 'Operator key',
      teamId: '770e8400-e29b-41d4-a716-446655440002',
    });

    for (const [input, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ targetAddressSpace: 'loopback' });
      const request =
        input instanceof Request ? input : new Request(input, init);
      expect(request.url).toMatch(/^http:\/\/127\.0\.0\.1:17373\//);
      expect(request.credentials).toBe('omit');
      const headers = request.headers;
      expect(headers.has('authorization')).toBe(false);
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('x-moltnet-session-token')).toBe(false);
      expect(await request.clone().text()).not.toMatch(
        /access.?token|refresh.?token|session.?token|authorization|cookie/i,
      );
    }
    expect(
      (fetchMock.mock.calls[1]?.[0] as Request).headers.get(
        'x-moltnet-signer-session',
      ),
    ).toBe('process-capability');
  });

  it('rejects non-loopback companion URLs', () => {
    expect(() =>
      createSignerCompanionClient({
        baseUrl: 'https://signer.attacker.example',
      }),
    ).toThrow(/loopback/u);
  });

  it('rejects non-loopback approval URLs returned by the companion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            version: 1,
            token: 'process-capability',
            expiresAt: '2030-08-01T12:05:00.000Z',
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            version: 1,
            id: 'ceremony-id',
            operation: 'credential-enrollment',
            approvalUrl: 'https://attacker.example/approve',
            expiresAt: '2030-08-01T12:05:00.000Z',
          },
          { status: 201 },
        ),
      );
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: fetchMock,
    });

    await expect(
      client.createCeremony({
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      }),
    ).rejects.toThrow('Signer companion returned an invalid ceremony');
  });

  it('configures the generated transport to reject redirects', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const redirect =
        input instanceof Request ? input.redirect : init?.redirect;
      expect(redirect).toBe('error');
      return Promise.resolve(
        Response.json(
          {
            version: 1,
            token: 'process-capability',
            expiresAt: '2030-08-01T12:05:00.000Z',
          },
          { status: 201 },
        ),
      );
    });
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: fetchMock,
    });

    await client.connect();
  });

  it('preserves typed companion error codes for actionable remediation', async () => {
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { code: 'device_timeout', message: 'Reconnect the key' },
            { status: 504 },
          ),
        ),
      ),
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'device_timeout',
      message: 'Reconnect the key',
      status: 504,
    });
  });

  it('preserves status and non-JSON response context for diagnostics', async () => {
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response('stale signer companion', {
            status: 502,
            headers: { 'content-type': 'text/plain' },
          }),
        ),
      ),
    });

    await expect(client.connect()).rejects.toMatchObject({
      cause: 'stale signer companion',
      code: 'http_502',
      message: 'stale signer companion',
      status: 502,
    });
  });

  it('bounds an unavailable loopback request', async () => {
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      requestTimeoutMs: 10,
      fetch: vi.fn<typeof fetch>(
        (input, init) =>
          new Promise((_resolve, reject) => {
            const signal =
              input instanceof Request ? input.signal : init?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'request_timeout',
    });
  });

  it('propagates caller aborts during a result request', async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            version: 1,
            token: 'process-capability',
            expiresAt: '2030-08-01T12:05:00.000Z',
          },
          { status: 201 },
        ),
      )
      .mockImplementationOnce(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal =
              _input instanceof Request ? _input.signal : init?.signal;
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      );
    const client = createSignerCompanionClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: fetchMock,
    });
    await client.connect();

    const result = client.getResult('ceremony-id', {
      signal: controller.signal,
    });
    controller.abort(new DOMException('Stopped', 'AbortError'));

    await expect(result).rejects.toMatchObject({
      code: 'companion_unavailable',
    });
  });

  it('stops polling when the caller aborts between requests', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              version: 1,
              token: 'process-capability',
              expiresAt: '2030-08-01T12:05:00.000Z',
            },
            { status: 201 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json({
            version: 1,
            status: 'pending',
            operation: 'credential-enrollment',
          }),
        );
      const client = createSignerCompanionClient({
        baseUrl: 'http://127.0.0.1:17373',
        fetch: fetchMock,
      });
      const controller = new AbortController();
      const reason = new DOMException('Stopped', 'AbortError');
      await client.connect();

      const result = client.waitForResult('ceremony-id', {
        signal: controller.signal,
        pollIntervalMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      controller.abort(reason);

      await expect(result).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
