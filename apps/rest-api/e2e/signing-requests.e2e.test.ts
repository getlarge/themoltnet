/**
 * E2E: Signing request lifecycle
 *
 * Tests the full DBOS signing workflow: create request → sign locally
 * → submit signature → verify. Uses real auth tokens, real DBOS
 * workflows, and real crypto operations.
 *
 * Signing uses the deterministic pre-hash protocol (buildSigningBytes):
 *   signing_bytes = "moltnet:v1" || u32be(32) || SHA256(message) || u32be(len(nonce)) || nonce
 */

import {
  type Client,
  createClient,
  createSigningRequest,
  getSigningRequest,
  listSigningRequests,
  submitSignature,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Signing requests', () => {
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

  // ── Create ──────────────────────────────────────────────────

  it('creates a signing request', async () => {
    const { data, error } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: 'Hello from e2e' },
    });

    expect(error).toBeUndefined();
    expect(data!.id).toBeDefined();
    expect(data!.message).toBe('Hello from e2e');
    expect(data!.nonce).toBeDefined();
    expect(data!.status).toBe('pending');
    expect(data!.agentId).toBe(agent.identityId);
    expect(data!.expiresAt).toBeDefined();
  });

  it('rejects unauthenticated create', async () => {
    const { error, response } = await createSigningRequest({
      client,
      body: { message: 'Should fail' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(401);
  });

  // ── List ────────────────────────────────────────────────────

  it('lists signing requests for the agent', async () => {
    const { data, error } = await listSigningRequests({
      client,
      auth: () => agent.accessToken,
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThanOrEqual(1);
    expect(data!.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by status', async () => {
    const { data, error } = await listSigningRequests({
      client,
      auth: () => agent.accessToken,
      query: { status: 'pending' },
    });

    expect(error).toBeUndefined();
    for (const item of data!.items) {
      expect(item.status).toBe('pending');
    }
  });

  // ── Get ─────────────────────────────────────────────────────

  it('gets a signing request by ID', async () => {
    const { data: created } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: 'Get test' },
    });

    const { data, error } = await getSigningRequest({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
    });

    expect(error).toBeUndefined();
    expect(data!.id).toBe(created!.id);
    expect(data!.message).toBe('Get test');
  });

  it('returns 404 for non-existent request', async () => {
    const { error, response } = await getSigningRequest({
      client,
      auth: () => agent.accessToken,
      path: { id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(404);
  });

  // ── Sign (full workflow) ────────────────────────────────────

  it('signs a message and verifies the signature', async () => {
    const message = 'Sign this e2e message';

    // 1. Create signing request
    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message },
    });
    expect(request!.status).toBe('pending');

    // 2. Sign locally using deterministic pre-hash (buildSigningBytes)
    const signature = await cryptoService.signWithNonce(
      message,
      request!.nonce,
      agent.keyPair.privateKey,
    );

    // 3. Submit signature
    const { data: result, error } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature },
    });

    expect(error).toBeUndefined();
    expect(result!.status).toBe('completed');
    expect(result!.valid).toBe(true);
    expect(result!.signature).toBe(signature);
    expect(result!.completedAt).toBeDefined();
  });

  it('rejects signature submission for already completed request', async () => {
    const message = 'Double sign test';

    // Create and complete a request
    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message },
    });

    const signature = await cryptoService.signWithNonce(
      message,
      request!.nonce,
      agent.keyPair.privateKey,
    );

    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature },
    });

    // Try to submit again
    const { error, response } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(409);
  });

  // ── Adversarial message payloads ────────────────────────────

  it('signs and verifies a multiline message (LF)', async () => {
    const message = 'line1\nline2\nline3';

    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message },
    });
    expect(request!.message).toBe(message);

    const signature = await cryptoService.signWithNonce(
      message,
      request!.nonce,
      agent.keyPair.privateKey,
    );

    const { data: result, error } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature },
    });

    expect(error).toBeUndefined();
    expect(result!.status).toBe('completed');
    expect(result!.valid).toBe(true);
  });

  it('signs and verifies a message with Unicode (em-dash and emoji)', async () => {
    const message = 'sign this — with a 🔑';

    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message },
    });

    const signature = await cryptoService.signWithNonce(
      message,
      request!.nonce,
      agent.keyPair.privateKey,
    );

    const { data: result, error } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature },
    });

    expect(error).toBeUndefined();
    expect(result!.status).toBe('completed');
    expect(result!.valid).toBe(true);
  });

  it('rejects tampered signature (wrong key signs with new protocol)', async () => {
    const message = 'Tamper test';

    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message },
    });

    // Sign with a different keypair
    const wrongKeyPair = await cryptoService.generateKeyPair();
    const wrongSignature = await cryptoService.signWithNonce(
      message,
      request!.nonce,
      wrongKeyPair.privateKey,
    );

    const { data: result, error } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature: wrongSignature },
    });

    expect(error).toBeUndefined();
    expect(result!.status).toBe('completed');
    expect(result!.valid).toBe(false);
  });
});
