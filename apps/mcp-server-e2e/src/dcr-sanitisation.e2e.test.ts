/**
 * E2E: Dynamic Client Registration is proxied and sanitised
 *
 * Simulates what ChatGPT and Claude Desktop do when you add MoltNet as a
 * connector: they hold no credentials, so they self-register at the
 * `registration_endpoint` advertised in the authorization server's metadata,
 * then run the normal authorization_code login.
 *
 * Two properties are asserted against a real Hydra:
 *
 *  1. Registration works WITHOUT credentials at POST /oauth/register. It has
 *     to — the client is registering in order to get some. fastify-mcp serves
 *     that route unauthenticated already; no excludedPaths entry is needed.
 *
 *  2. Client-supplied token lifespans are stripped. Hydra accepts and PERSISTS
 *     per-client lifespan overrides from a DCR payload — verified directly
 *     against Hydra, which stored `client_credentials_grant_access_token_
 *     lifespan: 720h0m0s` from an unauthenticated registration. A client could
 *     otherwise hand itself a 720h token while the project TTL is 24h, undoing
 *     the cost control and the bound on how long a leaked token stays usable
 *     (issue #1860). Hydra offers no server-side switch for this, so the proxy
 *     is the only enforcement point.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

const HYDRA_ADMIN_URL =
  process.env.ORY_HYDRA_ADMIN_URL ?? 'http://localhost:4445';

interface RegisteredClient {
  client_id?: string;
  client_name?: string;
  [key: string]: unknown;
}

/** Every per-client lifespan override Hydra accepts. */
const LIFESPAN_FIELDS = [
  'authorization_code_grant_access_token_lifespan',
  'client_credentials_grant_access_token_lifespan',
  'refresh_token_grant_access_token_lifespan',
] as const;

function dcrPayload(overrides: Record<string, unknown> = {}) {
  return {
    client_name: `e2e-dcr-${Math.random().toString(36).slice(2, 10)}`,
    redirect_uris: ['http://localhost:9999/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'openid offline_access',
    ...overrides,
  };
}

async function register(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<{ status: number; client: RegisteredClient }> {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, client: (await res.json()) as RegisteredClient };
}

/** Read the client back from Hydra — the response body is not proof of storage. */
async function readClient(clientId: string): Promise<RegisteredClient> {
  const res = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${clientId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as RegisteredClient;
}

describe('DCR through the MCP server', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createMcpTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('registers a client without any credentials', async () => {
    // Act — no Authorization header, exactly like a fresh connector
    const { status, client } = await register(harness.mcpBaseUrl, dcrPayload());

    // Assert
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(client.client_id).toBeTruthy();
  });

  it('strips client-supplied token lifespans before they reach Hydra', async () => {
    // Arrange — a client trying to give itself 720h tokens
    const payload = dcrPayload({
      authorization_code_grant_access_token_lifespan: '720h',
      client_credentials_grant_access_token_lifespan: '720h',
      refresh_token_grant_access_token_lifespan: '720h',
    });

    // Act
    const { status, client } = await register(harness.mcpBaseUrl, payload);
    expect(status).toBeLessThan(300);
    const stored = await readClient(client.client_id!);

    // Assert — Hydra must hold no override, so the project TTL governs
    for (const field of LIFESPAN_FIELDS) {
      expect(stored[field] ?? null).toBeNull();
    }
  });

  it('still registers the client the caller actually asked for', async () => {
    // Sanitising must not mangle the rest of the payload.
    const payload = dcrPayload({
      client_credentials_grant_access_token_lifespan: '720h',
    });

    // Act
    const { client } = await register(harness.mcpBaseUrl, payload);
    const stored = await readClient(client.client_id!);

    // Assert
    expect(stored.client_name).toBe(payload.client_name);
    expect(stored.redirect_uris).toEqual(payload.redirect_uris);
    expect(stored.grant_types).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token']),
    );
  });

  it('proves the stripping is load-bearing: Hydra persists lifespans when not stripped', async () => {
    // Registering straight against Hydra — the path discovery used to
    // advertise — must still show the override being stored. If this ever
    // stops being true, the sanitisation above is dead weight and should be
    // reconsidered rather than left as unexplained ceremony.
    const hydraPublicUrl =
      process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://localhost:4444';
    const payload = dcrPayload({
      client_credentials_grant_access_token_lifespan: '720h',
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
    });

    // Act
    const res = await fetch(`${hydraPublicUrl}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const direct = (await res.json()) as RegisteredClient;
    const stored = await readClient(direct.client_id!);

    // Assert — unsanitised, the override sticks
    expect(stored.client_credentials_grant_access_token_lifespan).toBe(
      '720h0m0s',
    );
  });
});
