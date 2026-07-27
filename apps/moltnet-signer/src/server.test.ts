import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignerCeremonyService } from './ceremony-service.js';
import { createSignerServer } from './server.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const servers: ReturnType<typeof createSignerServer>[] = [];

function rawRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number | undefined;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: options.method, headers: options.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
            status: response.statusCode,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
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
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('loopback signer server', () => {
  it('binds an origin to a capability and keeps approval on its own page', async () => {
    const { baseUrl } = await fixture();
    const sessionResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { origin: CONSOLE_ORIGIN },
    });
    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.headers.get('access-control-allow-origin')).toBe(
      CONSOLE_ORIGIN,
    );
    const session = (await sessionResponse.json()) as { token: string };

    const ceremonyResponse = await fetch(`${baseUrl}/v1/ceremonies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: CONSOLE_ORIGIN,
        'x-moltnet-signer-session': session.token,
      },
      body: JSON.stringify({
        version: 1,
        operation: 'credential-enrollment',
        label: '<script>Operator key</script>',
        teamId: '770e8400-e29b-41d4-a716-446655440002',
      }),
    });
    expect(ceremonyResponse.status).toBe(201);
    const ceremony = (await ceremonyResponse.json()) as {
      id: string;
    };

    const approvalResponse = await rawRequest(
      `${baseUrl}/ceremonies/${ceremony.id}`,
      {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'cross-site',
        },
      },
    );
    const approval = approvalResponse.body;
    expect(approval).toContain('Sign exact action');
    expect(approval).toContain('&lt;script&gt;Operator key&lt;/script&gt;');
    expect(approval).not.toContain('<script>');
    expect(approvalResponse.headers['content-security-policy']).toContain(
      "form-action 'self'",
    );
    const confirmationToken = approval.match(
      /name="confirmationToken" value="([^"]+)"/u,
    )?.[1];
    expect(confirmationToken).toBeDefined();

    const crossSiteConfirmation = await rawRequest(
      `${baseUrl}/ceremonies/${ceremony.id}/confirm`,
      {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': 'cross-site',
        },
        body: new URLSearchParams({
          confirmationToken: confirmationToken ?? '',
        }).toString(),
      },
    );
    expect(crossSiteConfirmation.status).toBe(403);

    const confirmation = await rawRequest(
      `${baseUrl}/ceremonies/${ceremony.id}/confirm`,
      {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': 'same-origin',
        },
        body: new URLSearchParams({
          confirmationToken: confirmationToken ?? '',
        }).toString(),
      },
    );
    expect(confirmation.status).toBe(200);
  });

  it('rejects unapproved origins and non-loopback Host headers', async () => {
    const { baseUrl } = await fixture();
    const originResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    expect(originResponse.status).toBe(403);
    const missingOriginResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
    });
    expect(missingOriginResponse.status).toBe(403);
    const preflightResponse = await fetch(`${baseUrl}/v1/ceremonies`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflightResponse.status).toBe(403);
    expect(preflightResponse.headers.has('access-control-allow-origin')).toBe(
      false,
    );

    const hostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/health`,
          { headers: { host: 'attacker.example' } },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        request.on('error', reject);
        request.end();
      },
    );
    expect(hostStatus).toBe(400);
  });
});
