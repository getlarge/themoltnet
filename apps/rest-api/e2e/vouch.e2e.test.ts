/**
 * E2E: Voucher system — web-of-trust registration gate
 *
 * Tests the full voucher lifecycle: issue, list, redeem, trust graph.
 * Uses real auth tokens, real database, real Ory services.
 */

import {
  type Client,
  createClient,
  getTrustGraph,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Voucher System', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Issue Voucher ───────────────────────────────────────────

  describe('POST /vouch', () => {
    it('issues a voucher code', async () => {
      const { data, error, response } = await issueVoucher({
        client,
        auth: () => agent.accessToken,
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(data!.code).toBeDefined();
      expect(data!.code.length).toBe(64); // 32 bytes hex
      expect(data!.expiresAt).toBeDefined();
      expect(data!.issuedBy).toBe(agent.keyPair.fingerprint);
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await issueVoucher({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });

    it('enforces max 5 active vouchers', async () => {
      // Issue 4 more vouchers (we already have 1 from the first test)
      for (let i = 0; i < 4; i++) {
        const { error } = await issueVoucher({
          client,
          auth: () => agent.accessToken,
        });
        expect(error).toBeUndefined();
      }

      // The 6th should fail with 429
      const { data, error, response } = await issueVoucher({
        client,
        auth: () => agent.accessToken,
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(429);

      const problem = error as Record<string, unknown>;
      expect(problem.code).toBe('VOUCHER_LIMIT');
    });
  });

  // ── List Active Vouchers ────────────────────────────────────

  describe('GET /vouch/active', () => {
    it('lists active vouchers for the authenticated agent', async () => {
      const { data, error } = await listActiveVouchers({
        client,
        auth: () => agent.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.vouchers).toBeDefined();
      expect(data!.vouchers.length).toBe(5); // 5 issued, none redeemed
      for (const v of data!.vouchers) {
        expect(v.code).toBeDefined();
        expect(v.expiresAt).toBeDefined();
        expect(v.issuedBy).toBe(agent.keyPair.fingerprint);
      }
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await listActiveVouchers({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  // ── Trust Graph ─────────────────────────────────────────────

  describe('GET /vouch/graph', () => {
    it('returns trust graph with redeemed vouchers', async () => {
      // The agent was created via a redeemed voucher from bootstrap identity,
      // so there should be at least one edge in the graph.
      const { data, error } = await getTrustGraph({ client });

      expect(error).toBeUndefined();
      expect(data!.edges).toBeDefined();
      expect(data!.edges.length).toBeGreaterThanOrEqual(1);

      const edge = data!.edges.find(
        (e) => e.redeemerFingerprint === agent.keyPair.fingerprint,
      );
      expect(edge).toBeDefined();
      expect(edge!.redeemedAt).toBeDefined();
    });

    it('is publicly accessible (no auth required)', async () => {
      const { error, response } = await getTrustGraph({ client });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
    });
  });
});
