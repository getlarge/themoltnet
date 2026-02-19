/**
 * E2E: Agent profiles, whoami, crypto operations
 *
 * Tests agent registration, profile lookup, signature verification,
 * and crypto challenge flows using real auth and real crypto.
 */

import {
  type Client,
  createClient,
  createSigningRequest,
  getAgentProfile,
  getCryptoIdentity,
  getWhoami,
  submitSignature,
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
  let otherAgent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create vouchers from the bootstrap identity
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    const otherVoucherCode = await createTestVoucher({
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

    otherAgent = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: otherVoucherCode,
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
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { signature },
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
          signature: 'dGhpcyBpcyBub3QgYSB2YWxpZCBzaWduYXR1cmU=',
        },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });

    it('rejects signature from wrong key', async () => {
      const otherKeyPair = await cryptoService.generateKeyPair();
      const message = 'Signed by wrong agent';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        otherKeyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });

    it('rejects signature that belongs to another agent', async () => {
      const message = 'signature bound to agent';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: otherAgent.keyPair.fingerprint },
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });
  });

  // ── Crypto Verify (public) ──────────────────────────────────

  describe('POST /crypto/verify', () => {
    it('verifies a standalone Ed25519 signature', async () => {
      const message = 'standalone crypto check';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyCryptoSignature({
        client,
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
    });

    it('returns false for unknown signatures', async () => {
      const signature = 'dW5rbm93bi1zaWduYXR1cmU=';

      const { data, error } = await verifyCryptoSignature({
        client,
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(false);
    });

    it('returns false for signatures not yet submitted', async () => {
      const message = 'unsigned signature';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { data, error } = await verifyCryptoSignature({
        client,
        body: { signature },
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

  describe('Signing verification', () => {
    it('verifies via the public crypto endpoint', async () => {
      const message = 'crypto verify request';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyCryptoSignature({
        client,
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
    });

    it('verifies via agent lookup', async () => {
      const message = 'agent verify request';
      const { data: request, error: createError } = await createSigningRequest({
        client,
        auth: () => agent.accessToken,
        body: { message },
      });

      expect(createError).toBeUndefined();

      const signature = await cryptoService.signWithNonce(
        request!.message,
        request!.nonce,
        agent.keyPair.privateKey,
      );

      const { error: submitError } = await submitSignature({
        client,
        auth: () => agent.accessToken,
        path: { id: request!.id },
        body: { signature },
      });

      expect(submitError).toBeUndefined();

      const { data, error } = await verifyAgentSignature({
        client,
        path: { fingerprint: agent.keyPair.fingerprint },
        body: { signature },
      });

      expect(error).toBeUndefined();
      expect(data!.valid).toBe(true);
      expect(data!.signer!.fingerprint).toBe(agent.keyPair.fingerprint);
    });
  });
});
