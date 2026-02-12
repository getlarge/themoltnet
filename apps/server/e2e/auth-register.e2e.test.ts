/**
 * E2E: POST /auth/register — Registration Proxy
 *
 * Tests the server-side proxy that wraps the Kratos self-service
 * registration flow into a single POST call. Covers:
 *
 * 1. Happy path: valid public key + voucher → identity + OAuth2 credentials
 * 2. Returned credentials work for client_credentials grant
 * 3. Invalid voucher → 403 with detail mentioning voucher
 * 4. Malformed public key → 400 with detail mentioning ed25519
 * 5. Already-used voucher → 403
 */

import { createClient, getWhoami } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestVoucher } from './helpers.js';
import {
  createTestHarness,
  HYDRA_PUBLIC_URL,
  type TestHarness,
} from './setup.js';

describe('POST /auth/register', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Happy Path ──────────────────────────────────────────────

  it('registers an agent with valid public key and voucher', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const res = await fetch(`${harness.baseUrl}/auth/register`, {
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

    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      identityId: string;
      fingerprint: string;
      publicKey: string;
      clientId: string;
      clientSecret: string;
    };

    expect(data.identityId).toBeDefined();
    expect(data.fingerprint).toBe(keyPair.fingerprint);
    expect(data.publicKey).toBe(keyPair.publicKey);
    expect(data.clientId).toBeDefined();
    expect(data.clientSecret).toBeDefined();
  });

  // ── Credential Flow ───────────────────────────────────────────

  it('returned credentials can acquire a Bearer token', async () => {
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
      clientId: string;
      clientSecret: string;
    };

    // Exchange credentials for an access token
    const tokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as { access_token: string };
    expect(tokenData.access_token).toBeDefined();
  });

  it('returned credentials allow calling /agents/whoami', async () => {
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

    // Get access token
    const tokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };

    // Call whoami with the token
    const client = createClient({ baseUrl: harness.baseUrl });
    const { data, error } = await getWhoami({
      client,
      auth: () => access_token,
    });

    expect(error).toBeUndefined();
    expect(data!.identityId).toBe(creds.identityId);
    expect(data!.fingerprint).toBe(creds.fingerprint);
    expect(data!.clientId).toBe(creds.clientId);
  });

  // ── Error Cases ─────────────────────────────────────────────

  it('rejects registration with invalid voucher code (403)', async () => {
    const keyPair = await cryptoService.generateKeyPair();

    const res = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: keyPair.publicKey,
        voucher_code: 'nonexistent-voucher-code',
      }),
    });

    expect(res.status).toBe(403);

    const data = (await res.json()) as { detail?: string; code?: string };
    expect(data.detail?.toLowerCase()).toContain('voucher');
  });

  it('rejects registration with malformed public key (400)', async () => {
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const res = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: 'not-ed25519-format',
        voucher_code: voucherCode,
      }),
    });

    expect(res.status).toBe(400);

    const data = (await res.json()) as { detail?: string; code?: string };
    expect(data.detail?.toLowerCase()).toContain('ed25519');
  });

  it('rejects registration with already-used voucher (403)', async () => {
    // Use the voucher with the first registration
    const keyPair1 = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const res1 = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: keyPair1.publicKey,
        voucher_code: voucherCode,
      }),
    });
    expect(res1.status).toBe(200);

    // Try to reuse the same voucher
    const keyPair2 = await cryptoService.generateKeyPair();

    const res2 = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        public_key: keyPair2.publicKey,
        voucher_code: voucherCode,
      }),
    });

    expect(res2.status).toBe(403);
  });

  // ── Rotate Secret ──────────────────────────────────────────

  it('rotates client secret and new secret works', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    // Register
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
    const oldSecret = creds.clientSecret;

    // Get access token with original credentials
    const tokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };

    // Rotate the secret
    const rotateRes = await fetch(`${harness.baseUrl}/auth/rotate-secret`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    });

    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as {
      clientId: string;
      clientSecret: string;
    };

    expect(rotated.clientId).toBe(creds.clientId);
    expect(rotated.clientSecret).toBeDefined();
    expect(rotated.clientSecret).not.toBe(oldSecret);

    // New secret works for token acquisition
    const newTokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: rotated.clientId,
        client_secret: rotated.clientSecret,
      }),
    });
    expect(newTokenRes.status).toBe(200);

    // Old secret no longer works
    const oldTokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: oldSecret,
      }),
    });
    expect(oldTokenRes.status).not.toBe(200);
  });

  it('rejects rotate-secret without authentication', async () => {
    const res = await fetch(`${harness.baseUrl}/auth/rotate-secret`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    expect(res.status).toBe(401);
  });

  // ── Validation ──────────────────────────────────────────────

  it('returns 400 when body is missing required fields', async () => {
    const res = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});
