/**
 * E2E: POST /oauth2/token — Token Proxy
 *
 * Verifies the OAuth2 token proxy forwards client_credentials grants
 * to Hydra and returns valid access tokens.
 *
 * 1. Happy path: register agent, exchange credentials via proxy → access_token
 * 2. Access token from proxy works for /agents/whoami
 * 3. Invalid credentials → 401 passthrough
 * 4. Unknown grant_type is forwarded — Hydra decides, not the proxy
 * 5. Repeat client_credentials grants are served from cache (issue #1860)
 */

import { createClient, getWhoami } from '@moltnet/api-client';
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher } from './helpers.js';
import {
  createTestHarness,
  SERVER_BASE_URL,
  type TestHarness,
} from './setup.js';

describe('POST /oauth2/token (proxy)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('exchanges valid credentials for an access token via proxy', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    // Register to get OAuth2 credentials
    const regRes = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: keyPair.publicKey,
        voucher_code: voucherCode,
      }),
    });

    expect(regRes.status).toBe(200);
    const creds = (await regRes.json()) as {
      clientId: string;
      clientSecret: string;
    };

    // Exchange via proxy
    const tokenRes = await fetch(`${SERVER_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: AGENT_OAUTH_SCOPES.join(' '),
      }),
    });

    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.token_type).toBe('bearer');
    expect(tokenData.expires_in).toBeGreaterThan(0);
  });

  it('proxy-issued token works for /agents/whoami', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const regRes = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: keyPair.publicKey,
        voucher_code: voucherCode,
      }),
    });
    expect(regRes.status).toBe(200);
    const creds = (await regRes.json()) as {
      identityId: string;
      fingerprint: string;
      clientId: string;
      clientSecret: string;
    };

    // Get token via proxy
    const tokenRes = await fetch(`${SERVER_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: AGENT_OAUTH_SCOPES.join(' '),
      }),
    });
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };

    // Use token to call whoami
    const client = createClient({ baseUrl: harness.baseUrl });
    const { data, error } = await getWhoami({
      client,
      auth: () => access_token,
    });

    expect(error).toBeUndefined();
    expect(data!.identityId).toBe(creds.identityId);
    expect(data!.fingerprint).toBe(creds.fingerprint);
  });

  it('returns 401 for invalid credentials', async () => {
    const tokenRes = await fetch(`${SERVER_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'nonexistent-client',
        client_secret: 'wrong-secret',
      }),
    });

    expect(tokenRes.status).toBe(401);
  });

  it('forwards an authorization_code grant to Hydra instead of rejecting it', async () => {
    // The proxy no longer gates grant types: it is advertised as the token
    // endpoint, so Hydra stays the authority. A bogus code must therefore be
    // rejected by Hydra, not by us — asserted here against real Hydra so the
    // passthrough cannot regress to a local allowlist.
    const tokenRes = await fetch(`${SERVER_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'some-code',
        redirect_uri: 'http://localhost:9999/callback',
      }),
    });

    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
    const body = (await tokenRes.json()) as { error?: string };
    // Hydra's own vocabulary, not the proxy's former 'unsupported_grant_type'
    expect(body.error).toBeDefined();
    expect(body.error).not.toBe('unsupported_grant_type');
  });

  it('serves a repeat client_credentials grant from cache', async () => {
    // Real Hydra mints a distinct access token per grant, so two identical
    // requests returning the same token proves the cache served the second —
    // i.e. that a billed M2M token was not issued (issue #1860).
    const agent = await createAgent({
      baseUrl: SERVER_BASE_URL,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    const grant = () =>
      fetch(`${SERVER_BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: agent.clientId,
          client_secret: agent.clientSecret,
          scope: AGENT_OAUTH_SCOPES.join(' '),
        }),
      });

    const first = (await (await grant()).json()) as {
      access_token: string;
      expires_in: number;
    };
    const second = (await (await grant()).json()) as {
      access_token: string;
      expires_in: number;
    };

    expect(first.access_token).toBeTruthy();
    expect(second.access_token).toBe(first.access_token);
    // The cached reply reports the life left, never more than the original.
    expect(second.expires_in).toBeLessThanOrEqual(first.expires_in);
  });
});
