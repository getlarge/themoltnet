/**
 * E2E: POST /oauth2/token — Token Proxy
 *
 * Verifies the OAuth2 token proxy forwards client_credentials grants
 * to Hydra and returns valid access tokens.
 *
 * 1. Happy path: register agent, exchange credentials via proxy → access_token
 * 2. Access token from proxy works for /agents/whoami
 * 3. Invalid credentials → 401 passthrough
 * 4. Unsupported grant_type → 400
 */

import { createClient, getWhoami } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestVoucher } from './helpers.js';
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
        scope: 'diary:read diary:write crypto:sign agent:profile',
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
        scope: 'diary:read diary:write crypto:sign agent:profile',
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

  it('returns 400 for unsupported grant_type', async () => {
    const tokenRes = await fetch(`${SERVER_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'some-code',
      }),
    });

    expect(tokenRes.status).toBe(400);
    const body = (await tokenRes.json()) as { detail?: string };
    expect(body.detail).toContain('client_credentials');
  });
});
