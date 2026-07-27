import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignerCeremonyService } from './ceremony-service.js';
import { createSignerServer } from './server.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const fixtures: {
  server: FastifyInstance;
  service: SignerCeremonyService;
}[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ server, service }) => {
      service.dispose();
      await server.close();
    }),
  );
});

async function fixture() {
  let sequence = 0;
  const service = new SignerCeremonyService({
    allowedOrigins: [CONSOLE_ORIGIN],
    apiUrl: 'https://api.themolt.net',
    device: {
      enroll: vi.fn(() =>
        Promise.resolve({
          version: 1,
          outerCredentialId: 'Y3JlZGVudGlhbA',
          outerPublicKey: {
            kty: 2,
            algorithm: -7,
            curve: 1,
            x: 'A'.repeat(43),
            y: 'B'.repeat(43),
          },
          previewKeyHandle: 'aGFuZGxl',
          seedPublicKey: {
            kty: -65537,
            algorithm: -65700,
            derivedAlgorithm: -9,
            blindingKey: {
              kty: 2,
              algorithm: -7,
              curve: 1,
              x: 'C'.repeat(43),
              y: 'D'.repeat(43),
            },
            kemKey: {
              kty: 2,
              algorithm: -25,
              curve: 1,
              x: 'E'.repeat(43),
              y: 'F'.repeat(43),
            },
          },
        } as const),
      ),
      signPreparedDigest: vi.fn(),
    },
    validateChallenge: vi.fn(() => Promise.resolve({ valid: true as const })),
    randomToken: () => `test-capability-${++sequence}`,
  });
  const server = createSignerServer(service);
  fixtures.push({ server, service });
  await server.ready();
  return { server };
}

async function createSession(server: FastifyInstance): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: {
      host: '127.0.0.1:17373',
      origin: CONSOLE_ORIGIN,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string }>().token;
}

describe('loopback signer server', () => {
  it('publishes only the typed JSON protocol used by Console', async () => {
    const { server } = await fixture();
    const spec = (
      server as unknown as {
        swagger(): {
          components?: {
            schemas?: Record<string, unknown>;
            securitySchemes?: Record<string, unknown>;
          };
          paths?: Record<string, unknown>;
        };
      }
    ).swagger();

    expect(Object.keys(spec.paths ?? {}).sort()).toEqual([
      '/v1/ceremonies',
      '/v1/ceremonies/{ceremonyId}/result',
      '/v1/sessions',
    ]);
    expect(spec.paths).toMatchObject({
      '/v1/sessions': {
        post: {
          operationId: 'createSignerSession',
          responses: {
            201: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SignerSession' },
                },
              },
            },
          },
        },
      },
      '/v1/ceremonies': {
        post: {
          operationId: 'createSignerCeremony',
          requestBody: {
            required: true,
          },
          security: [{ signerSession: [] }],
          responses: {
            201: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SignerCeremony' },
                },
              },
            },
          },
        },
      },
      '/v1/ceremonies/{ceremonyId}/result': {
        get: {
          operationId: 'getSignerCeremonyResult',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SignerCeremonyResult',
                  },
                },
              },
            },
          },
        },
      },
    });
    for (const schemaName of [
      'SignerCeremony',
      'SignerCeremonyRequest',
      'SignerCeremonyResult',
      'SignerProblem',
      'SignerSession',
    ]) {
      expect(spec.components?.schemas).toHaveProperty(schemaName);
    }
    expect(spec.components?.securitySchemes).toMatchObject({
      signerSession: {
        in: 'header',
        name: 'x-moltnet-signer-session',
        type: 'apiKey',
      },
    });
  });

  it('serves the Fastify application through its loopback listener', async () => {
    const { server } = await fixture();
    const address = await server.listen({ host: '127.0.0.1', port: 0 });

    const health = await fetch(`${address}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });

    const deniedSession = await fetch(`${address}/v1/sessions`, {
      method: 'POST',
    });
    expect(deniedSession.status).toBe(403);
  });

  it('binds an origin to a capability and keeps approval on its own page', async () => {
    const { server } = await fixture();
    const sessionResponse = await server.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: {
        host: '127.0.0.1:17373',
        origin: CONSOLE_ORIGIN,
      },
    });
    expect(sessionResponse.statusCode).toBe(201);
    expect(sessionResponse.headers['access-control-allow-origin']).toBe(
      CONSOLE_ORIGIN,
    );
    const session = sessionResponse.json<{ token: string }>();

    const ceremonyResponse = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:17373',
        origin: CONSOLE_ORIGIN,
        'x-moltnet-signer-session': session.token,
      },
      payload: {
        version: 1,
        operation: 'credential-enrollment',
        label: '<script>Operator key</script>',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      },
    });
    expect(ceremonyResponse.statusCode).toBe(201);
    const ceremony = ceremonyResponse.json<{ id: string }>();

    const approvalResponse = await server.inject({
      method: 'GET',
      url: `/ceremonies/${ceremony.id}`,
      headers: {
        accept: 'text/html',
        host: '[::1]:17373',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(approvalResponse.body).toContain('Sign exact action');
    expect(approvalResponse.body).toContain(
      '&lt;script&gt;Operator key&lt;/script&gt;',
    );
    expect(approvalResponse.body).not.toContain('<script>');
    expect(approvalResponse.headers['content-security-policy']).toContain(
      "form-action 'self'",
    );
    const confirmationToken = approvalResponse.body.match(
      /name="confirmationToken" value="([^"]+)"/u,
    )?.[1];
    expect(confirmationToken).toBeDefined();

    const crossSiteConfirmation = await server.inject({
      method: 'POST',
      url: `/ceremonies/${ceremony.id}/confirm`,
      headers: {
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
        host: '127.0.0.1:17373',
        'sec-fetch-site': 'cross-site',
      },
      payload: new URLSearchParams({
        confirmationToken: confirmationToken ?? '',
      }).toString(),
    });
    expect(crossSiteConfirmation.statusCode).toBe(403);

    const confirmation = await server.inject({
      method: 'POST',
      url: `/ceremonies/${ceremony.id}/confirm`,
      headers: {
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
        host: '127.0.0.1:17373',
        'sec-fetch-site': 'same-origin',
      },
      payload: new URLSearchParams({
        confirmationToken: confirmationToken ?? '',
      }).toString(),
    });
    expect(confirmation.statusCode).toBe(200);
  });

  it('rejects unapproved origins, preflights, and non-loopback Host headers', async () => {
    const { server } = await fixture();
    const originResponse = await server.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: {
        host: '127.0.0.1:17373',
        origin: 'https://attacker.example',
      },
    });
    expect(originResponse.statusCode).toBe(403);

    const missingOriginResponse = await server.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { host: '127.0.0.1:17373' },
    });
    expect(missingOriginResponse.statusCode).toBe(403);

    const preflightResponse = await server.inject({
      method: 'OPTIONS',
      url: '/v1/ceremonies',
      headers: {
        host: '127.0.0.1:17373',
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflightResponse.statusCode).toBe(403);
    expect(preflightResponse.headers).not.toHaveProperty(
      'access-control-allow-origin',
    );

    const hostResponse = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'attacker.example' },
    });
    expect(hostResponse.statusCode).toBe(400);
  });

  it('rejects malformed, oversized, and non-JSON ceremony bodies', async () => {
    const { server } = await fixture();
    const token = await createSession(server);
    const headers = {
      host: '127.0.0.1:17373',
      origin: CONSOLE_ORIGIN,
      'x-moltnet-signer-session': token,
    };

    const malformed = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{"version":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'ceremony_invalid' });

    const oversized = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({
        version: 1,
        operation: 'credential-enrollment',
        label: 'x'.repeat(17 * 1024),
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      }),
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json()).toMatchObject({ code: 'ceremony_invalid' });

    const wrongContentType = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: { ...headers, 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(wrongContentType.statusCode).toBe(400);
    expect(wrongContentType.json()).toMatchObject({
      code: 'ceremony_invalid',
    });
  });

  it('rejects a missing signer session with the documented typed error', async () => {
    const { server } = await fixture();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: {
        'content-type': 'application/json',
        host: '127.0.0.1:17373',
        origin: CONSOLE_ORIGIN,
      },
      payload: {
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'session_invalid',
      message: 'Signer session is required',
    });
  });

  it('rejects unknown and additional ceremony fields', async () => {
    const { server } = await fixture();
    const token = await createSession(server);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ceremonies',
      headers: {
        'content-type': 'application/json',
        host: '127.0.0.1:17373',
        origin: CONSOLE_ORIGIN,
        'x-moltnet-signer-session': token,
      },
      payload: {
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
        digest: 'client-selected-signing-input',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'ceremony_invalid' });

    const unknown = await server.inject({
      method: 'POST',
      url: '/not-a-signer-route',
      headers: {
        host: '127.0.0.1:17373',
        origin: CONSOLE_ORIGIN,
      },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      code: 'not_found',
      message: 'Route is not available',
    });
  });
});
