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

    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:17373\//);
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.has('authorization')).toBe(false);
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('x-moltnet-session-token')).toBe(false);
      expect(JSON.stringify(init?.body ?? '')).not.toMatch(
        /access.?token|refresh.?token|session.?token|authorization|cookie/i,
      );
    }
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get(
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
});
