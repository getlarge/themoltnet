/**
 * E2E: Agent profiles, whoami, and crypto operations
 */

import {
  type Client,
  createClient,
  getAgentProfile,
  getCryptoIdentity,
  getWhoami,
  verifyAgentSignature,
  verifyCryptoSignature,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { createAgentRepository } from '@moltnet/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AGENT_A_ID,
  createTestHarness,
  isDatabaseAvailable,
  type TestHarness,
} from './setup.js';

const AUTH_TOKEN = 'e2e-valid-token';

describe('Agents & Crypto', async () => {
  const available = await isDatabaseAvailable();
  if (!available) {
    it.skip('database not available — run `pnpm run docker:up`', () => {});
    return;
  }

  let harness: TestHarness;
  let client: Client;
  let agentRepo: ReturnType<typeof createAgentRepository>;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    agentRepo = createAgentRepository(harness.db);
  });

  beforeEach(async () => {
    await harness.cleanup();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Agent Profile ───────────────────────────────────────────

  describe('GET /agents/:moltbookName', () => {
    it('returns an agent profile', async () => {
      await agentRepo.upsert({
        identityId: AGENT_A_ID,
        moltbookName: 'TestAgent',
        publicKey: harness.keyPair.publicKey,
        fingerprint: harness.keyPair.fingerprint,
      });

      const { data, error } = await getAgentProfile({
        client,
        path: { moltbookName: 'TestAgent' },
      });

      expect(error).toBeUndefined();
      expect(data!.moltbookName).toBe('TestAgent');
      expect(data!.publicKey).toBe(harness.keyPair.publicKey);
      expect(data!.fingerprint).toBe(harness.keyPair.fingerprint);
      expect(data!.moltbookVerified).toBe(false);
    });

    it('returns 404 for unknown agent', async () => {
      const { data, error } = await getAgentProfile({
        client,
        path: { moltbookName: 'NonExistent' },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
    });
  });

  // ── Whoami ──────────────────────────────────────────────────

  describe('GET /agents/whoami', () => {
    it('returns authenticated agent identity', async () => {
      await agentRepo.upsert({
        identityId: AGENT_A_ID,
        moltbookName: 'TestAgent',
        publicKey: harness.keyPair.publicKey,
        fingerprint: harness.keyPair.fingerprint,
      });

      const { data, error } = await getWhoami({
        client,
        auth: () => AUTH_TOKEN,
      });

      expect(error).toBeUndefined();
      expect(data!.identityId).toBe(AGENT_A_ID);
      expect(data!.moltbookName).toBe('TestAgent');
    });

    it('rejects unauthenticated request', async () => {
      const { data, error } = await getWhoami({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
    });
  });

  // ── Agent Signature Verification ────────────────────────────

  describe('POST /agents/:moltbookName/verify', () => {
    it('verifies a valid signature', async () => {
      await agentRepo.upsert({
        identityId: AGENT_A_ID,
        moltbookName: 'TestAgent',
        publicKey: harness.keyPair.publicKey,
        fingerprint: harness.keyPair.fingerprint,
      });

      const message = 'Hello, MoltNet!';
      const signature = await cryptoService.sign(
        message,
        harness.keyPair.privateKey,
      );

      const { data, error } = await verifyAgentSignature({
        client,
        path: { moltbookName: 'TestAgent' },
        body: { message, signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
      expect(data!.signer).toBeDefined();
      expect(data!.signer!.moltbookName).toBe('TestAgent');
      expect(data!.signer!.fingerprint).toBe(harness.keyPair.fingerprint);
    });

    it('rejects an invalid signature', async () => {
      await agentRepo.upsert({
        identityId: AGENT_A_ID,
        moltbookName: 'TestAgent',
        publicKey: harness.keyPair.publicKey,
        fingerprint: harness.keyPair.fingerprint,
      });

      const { data, error } = await verifyAgentSignature({
        client,
        path: { moltbookName: 'TestAgent' },
        body: {
          message: 'Hello, MoltNet!',
          signature: 'dGhpcyBpcyBub3QgYSB2YWxpZCBzaWduYXR1cmU=',
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
      expect(data!.signer).toBeUndefined();
    });
  });

  // ── Crypto Verify (public endpoint) ─────────────────────────

  describe('POST /crypto/verify', () => {
    it('verifies a standalone Ed25519 signature', async () => {
      const message = 'standalone crypto check';
      const signature = await cryptoService.sign(
        message,
        harness.keyPair.privateKey,
      );

      const { data, error } = await verifyCryptoSignature({
        client,
        body: {
          message,
          signature,
          publicKey: harness.keyPair.publicKey,
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
    });

    it('rejects a tampered message', async () => {
      const signature = await cryptoService.sign(
        'original message',
        harness.keyPair.privateKey,
      );

      const { data, error } = await verifyCryptoSignature({
        client,
        body: {
          message: 'tampered message',
          signature,
          publicKey: harness.keyPair.publicKey,
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });
  });

  // ── Crypto Identity (authenticated) ─────────────────────────

  describe('GET /crypto/identity', () => {
    it('returns the authenticated agent crypto identity', async () => {
      const { data, error } = await getCryptoIdentity({
        client,
        auth: () => AUTH_TOKEN,
      });

      expect(error).toBeUndefined();
      expect(data!.identityId).toBe(AGENT_A_ID);
      expect(data!.publicKey).toBe(harness.authContext.publicKey);
      expect(data!.fingerprint).toBe(harness.authContext.fingerprint);
    });
  });
});
