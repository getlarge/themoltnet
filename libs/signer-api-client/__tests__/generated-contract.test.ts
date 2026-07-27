import { describe, expect, it, vi } from 'vitest';

import {
  createClient,
  createSignerCeremony,
  createSignerSession,
  getSignerCeremonyResult,
} from '../src/index.js';

describe('generated signer companion client', () => {
  it('owns the JSON paths and signer-session header serialization', async () => {
    const requests: Request[] = [];
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url.endsWith('/v1/sessions')) {
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
      }
      if (request.method === 'POST') {
        return Promise.resolve(
          Response.json(
            {
              version: 1,
              id: 'ceremony-id',
              operation: 'credential-enrollment',
              approvalUrl: 'http://127.0.0.1:17373/ceremonies/ceremony-id',
              expiresAt: '2030-08-01T12:05:00.000Z',
            },
            { status: 201 },
          ),
        );
      }
      return Promise.resolve(
        Response.json({
          version: 1,
          status: 'pending',
          operation: 'credential-enrollment',
        }),
      );
    });
    const client = createClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: fetchMock,
    });

    await createSignerSession({ client });
    await createSignerCeremony({
      auth: 'process-capability',
      body: {
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      },
      client,
    });
    await getSignerCeremonyResult({
      auth: 'process-capability',
      client,
      path: { ceremonyId: 'ceremony-id' },
    });

    expect(
      requests.map(({ method, url }) => [method, new URL(url).pathname]),
    ).toEqual([
      ['POST', '/v1/sessions'],
      ['POST', '/v1/ceremonies'],
      ['GET', '/v1/ceremonies/ceremony-id/result'],
    ]);
    expect(requests[1]?.headers.get('x-moltnet-signer-session')).toBe(
      'process-capability',
    );
    expect(requests[2]?.headers.get('x-moltnet-signer-session')).toBe(
      'process-capability',
    );
  });

  it('returns the documented typed problem for an error status', async () => {
    const client = createClient({
      baseUrl: 'http://127.0.0.1:17373',
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              code: 'session_invalid',
              message: 'Signer session is required',
            },
            { status: 401 },
          ),
        ),
      ),
    });

    const result = await createSignerCeremony({
      auth: 'expired-capability',
      body: {
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      },
      client,
    });

    expect(result.error).toEqual({
      code: 'session_invalid',
      message: 'Signer session is required',
    });
    expect(result.response.status).toBe(401);
  });
});
