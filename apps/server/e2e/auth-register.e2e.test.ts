/**
 * E2E: POST /auth/register — Registration Proxy
 *
 * Tests the server-side proxy that wraps the Kratos self-service
 * registration flow into a single POST call. Covers:
 *
 * 1. Happy path: valid public key + voucher → identity created
 * 2. Invalid voucher → 403 with detail mentioning voucher
 * 3. Malformed public key → 400 with detail mentioning ed25519
 * 4. Already-used voucher → 403
 */

import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestVoucher } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

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
      sessionToken: string | null;
    };

    expect(data.identityId).toBeDefined();
    expect(data.fingerprint).toBe(keyPair.fingerprint);
    expect(data.publicKey).toBe(keyPair.publicKey);
    expect(data.sessionToken).toBeDefined();
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
