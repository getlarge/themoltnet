/**
 * E2E: Agent profiles, whoami, crypto operations
 *
 * Tests agent registration, profile lookup, signature verification,
 * and crypto challenge flows using real auth and real crypto.
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Agents & Crypto', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create a voucher from the bootstrap identity
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

  // ── Agent Profile (public) ──────────────────────────────────

  describe('GET /agents/:fingerprint', () => {
    it('returns an agent profile', async () => {
      const { data, error } = await getAgentProfile({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
      });

      expect(error).toBeUndefined();
      expect(data!.publicKey).toBe(agent.keyPair.publicKey);
      expect(data!.fingerprint).toBe(agent.keyPair.fingerprint);
    });

    it('returns 404 for unknown agent in RFC 9457 format', async () => {
      const { data, error, response } = await getAgentProfile({
        client,
        path: { fingerprint: 'AAAA-BBBB-CCCC-DDDD' },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json',
      );

      const problem = error as Record<string, unknown>;
      expect(problem.type).toBe('https://themolt.net/problems/not-found');
      expect(problem.title).toBe('Not Found');
      expect(problem.status).toBe(404);
      expect(problem.code).toBe('NOT_FOUND');
    });
  });

  // ── Whoami (authenticated) ──────────────────────────────────

  describe('GET /agents/whoami', () => {
    it('returns authenticated agent identity with clientId', async () => {
      const { data, error } = await getWhoami({
        client,
        auth: () => agent.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.identityId).toBe(agent.identityId);
      expect(data!.fingerprint).toBe(agent.keyPair.fingerprint);
      expect(data!.clientId).toBe(agent.clientId);
    });

    it('rejects unauthenticated request with RFC 9457 format', async () => {
      const { data, error, response } = await getWhoami({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json',
      );

      const problem = error as Record<string, unknown>;
      expect(problem.type).toBe('https://themolt.net/problems/unauthorized');
      expect(problem.title).toBe('Unauthorized');
      expect(problem.status).toBe(401);
      expect(problem.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid token with RFC 9457 format', async () => {
      const { data, error, response } = await getWhoami({
        client,
        auth: () => 'definitely-not-a-valid-token',
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json',
      );

      const problem = error as Record<string, unknown>;
      expect(problem.type).toBe('https://themolt.net/problems/unauthorized');
      expect(problem.status).toBe(401);
      expect(problem.code).toBe('UNAUTHORIZED');
    });
  });

  // ── Agent Signature Verification ────────────────────────────

  describe('POST /agents/:fingerprint/verify', () => {
    it('verifies a valid Ed25519 signature', async () => {
      const message = 'Hello, MoltNet! Signed by CryptoTestAgent';
      const signature = await cryptoService.sign(
        message,
        agent.keyPair.privateKey,
      );

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { message, signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
      expect(data!.signer).toBeDefined();
      expect(data!.signer!.fingerprint).toBe(agent.keyPair.fingerprint);
    });

    it('rejects an invalid signature', async () => {
      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: {
          message: 'Hello, MoltNet!',
          signature: 'dGhpcyBpcyBub3QgYSB2YWxpZCBzaWduYXR1cmU=',
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });

    it('rejects signature from wrong key', async () => {
      const otherKeyPair = await cryptoService.generateKeyPair();
      const message = 'Signed by wrong agent';
      const signature = await cryptoService.sign(
        message,
        otherKeyPair.privateKey,
      );

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { message, signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });
  });

  // ── Crypto Verify (public) ──────────────────────────────────

  describe('POST /crypto/verify', () => {
    it('verifies a standalone Ed25519 signature', async () => {
      const message = 'standalone crypto check';
      const signature = await cryptoService.sign(
        message,
        agent.keyPair.privateKey,
      );

      const { data, error } = await verifyCryptoSignature({
        client,
        body: {
          message,
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
    });

    it('rejects a tampered message', async () => {
      const signature = await cryptoService.sign(
        'original message',
        agent.keyPair.privateKey,
      );

      const { data, error } = await verifyCryptoSignature({
        client,
        body: {
          message: 'tampered message',
          signature,
          publicKey: agent.keyPair.publicKey,
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
        auth: () => agent.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.identityId).toBe(agent.identityId);
      expect(data!.publicKey).toBe(agent.keyPair.publicKey);
      expect(data!.fingerprint).toBe(agent.keyPair.fingerprint);
    });
  });

  // ── Crypto Challenge Flow ───────────────────────────────────

  describe('Crypto challenge', () => {
    it('completes a sign-then-verify challenge', async () => {
      // 1. Generate a challenge message
      const challenge = cryptoService.generateChallenge();

      // 2. Agent signs the challenge
      const signature = await cryptoService.sign(
        challenge,
        agent.keyPair.privateKey,
      );

      // 3. Verifier checks via the public API
      const { data, error } = await verifyCryptoSignature({
        client,
        body: {
          message: challenge,
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
    });

    it('verifies via agent lookup (not just raw public key)', async () => {
      const challenge = cryptoService.generateChallenge();
      const signature = await cryptoService.sign(
        challenge,
        agent.keyPair.privateKey,
      );

      // Verify via the agent-scoped endpoint (looks up public key by fingerprint)
      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { message: challenge, signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
      expect(data!.signer!.fingerprint).toBe(agent.keyPair.fingerprint);
    });
  });
});
