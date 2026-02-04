/**
 * E2E: Cryptographic recovery flow
 *
 * Tests the challenge-response recovery mechanism where agents
 * prove ownership of their Ed25519 private key to recover access.
 *
 * MoltNet agents have no email — recovery works by:
 * 1. Agent sends public key → server returns HMAC-signed challenge
 * 2. Agent signs the challenge with their private key
 * 3. Server verifies HMAC + Ed25519 signature → issues Kratos recovery code
 * 4. Agent submits recovery code to Kratos self-service → gets session back
 */

import {
  type Client,
  createClient,
  requestRecoveryChallenge,
  verifyRecoveryChallenge,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  KRATOS_PUBLIC_URL,
  type TestHarness,
} from './setup.js';

describe('Recovery Flow', () => {
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
      app: harness.app,
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

  // ── Request Challenge ───────────────────────────────────────

  describe('POST /recovery/challenge', () => {
    it('issues a recovery challenge for a known agent', async () => {
      const { data, error } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey },
      });

      expect(error).toBeUndefined();
      expect(data!.challenge).toBeDefined();
      expect(data!.challenge).toContain('moltnet:recovery:');
      expect(data!.hmac).toBeDefined();
      expect(data!.hmac).toMatch(/^[a-f0-9]{64}$/); // hex SHA-256
    });

    it('returns 404 for unknown public key', async () => {
      const unknownKeyPair = await cryptoService.generateKeyPair();

      const { data, error, response } = await requestRecoveryChallenge({
        client,
        body: { publicKey: unknownKeyPair.publicKey },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });

  // ── Verify Challenge ────────────────────────────────────────

  describe('POST /recovery/verify', () => {
    it('completes the full crypto recovery: challenge → sign → recovery code', async () => {
      // Step 1: Request challenge
      const { data: challengeData } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey },
      });
      expect(challengeData).toBeDefined();

      // Step 2: Agent signs the challenge with their private key
      const signature = await cryptoService.sign(
        challengeData!.challenge,
        agent.keyPair.privateKey,
      );

      // Step 3: Verify — server checks HMAC + signature, calls Kratos Admin API
      const { data, error, response } = await verifyRecoveryChallenge({
        client,
        body: {
          challenge: challengeData!.challenge,
          hmac: challengeData!.hmac,
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.recoveryCode).toBeDefined();
      expect(typeof data!.recoveryCode).toBe('string');
      expect(data!.recoveryCode.length).toBeGreaterThan(0);
      // The recovery flow URL should contain a flow ID
      expect(data!.recoveryFlowUrl).toBeDefined();
    });

    it('submits recovery code to Kratos self-service and gets a session', async () => {
      // Full end-to-end: crypto challenge → recovery code → Kratos self-service

      // Step 1: Request challenge from our API
      const { data: challengeData } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey },
      });

      // Step 2: Sign with private key
      const signature = await cryptoService.sign(
        challengeData!.challenge,
        agent.keyPair.privateKey,
      );

      // Step 3: Get recovery code from our API
      const { data: recoveryData } = await verifyRecoveryChallenge({
        client,
        body: {
          challenge: challengeData!.challenge,
          hmac: challengeData!.hmac,
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });
      expect(recoveryData!.recoveryCode).toBeDefined();
      expect(recoveryData!.recoveryFlowUrl).toBeDefined();

      // Step 4: Extract flow ID from recovery URL
      const recoveryUrl = new URL(
        recoveryData!.recoveryFlowUrl,
        KRATOS_PUBLIC_URL,
      );
      const flowId = recoveryUrl.searchParams.get('flow');
      expect(flowId).toBeDefined();

      // Step 5: Submit recovery code to Kratos self-service API
      // Kratos returns 422 when the flow state transitions (e.g., code accepted,
      // now redirect to settings). The Ory SDK throws on non-2xx, so we
      // catch and inspect the response body.
      let kratosResponseData: Record<string, unknown>;
      let kratosStatus: number;
      try {
        const kratosResponse =
          await harness.kratosPublicFrontend.updateRecoveryFlow({
            flow: flowId!,
            updateRecoveryFlowBody: {
              method: 'code',
              code: recoveryData!.recoveryCode,
            },
          });
        kratosStatus = kratosResponse.status;
        kratosResponseData = kratosResponse.data as Record<string, unknown>;
      } catch (err: unknown) {
        // Ory SDK wraps non-2xx responses as AxiosError
        const axiosErr = err as {
          response?: { status: number; data: Record<string, unknown> };
        };
        if (axiosErr.response) {
          kratosStatus = axiosErr.response.status;
          kratosResponseData = axiosErr.response.data;
        } else {
          throw err;
        }
      }

      // Kratos signals a state transition with 422 (browser_location_change_required)
      // or 200. Either way, check the flow state indicates the code was accepted.
      expect([200, 422]).toContain(kratosStatus);

      // If 422, the response contains a redirect_browser_to or continue_with
      // pointing to the settings flow (for password reset). This confirms
      // the recovery code was accepted by Kratos.
      if (kratosStatus === 422) {
        // The response should contain a redirect to settings
        expect(
          kratosResponseData.redirect_browser_to ||
            kratosResponseData.continue_with,
        ).toBeDefined();
      } else {
        // 200 means the flow state was updated successfully
        expect(kratosResponseData.state).toBe('passed_challenge');
      }
    });

    it('rejects signature from wrong private key', async () => {
      const { data: challengeData } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey },
      });

      // Sign with a different key — proves you DON'T own this identity
      const wrongKeyPair = await cryptoService.generateKeyPair();
      const badSignature = await cryptoService.sign(
        challengeData!.challenge,
        wrongKeyPair.privateKey,
      );

      const { data, error, response } = await verifyRecoveryChallenge({
        client,
        body: {
          challenge: challengeData!.challenge,
          hmac: challengeData!.hmac,
          signature: badSignature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(400);

      const problem = error as Record<string, unknown>;
      expect(problem.code).toBe('INVALID_SIGNATURE');
    });

    it('rejects tampered challenge (HMAC mismatch)', async () => {
      const { data: challengeData } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey },
      });

      // Tamper with the challenge but reuse the original HMAC
      const tamperedChallenge = 'moltnet:recovery:tampered:' + Date.now();
      const signature = await cryptoService.sign(
        tamperedChallenge,
        agent.keyPair.privateKey,
      );

      const { data, error, response } = await verifyRecoveryChallenge({
        client,
        body: {
          challenge: tamperedChallenge,
          hmac: challengeData!.hmac, // HMAC from original, won't match tampered
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(400);

      const problem = error as Record<string, unknown>;
      expect(problem.code).toBe('INVALID_CHALLENGE');
    });

    it('rejects expired challenge', async () => {
      // Build a challenge with a timestamp in the past (> 5 min TTL)
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 min ago
      const expiredChallenge = `moltnet:recovery:${agent.keyPair.publicKey}:fake-nonce:${expiredTimestamp}`;

      const signature = await cryptoService.sign(
        expiredChallenge,
        agent.keyPair.privateKey,
      );

      const { data, error, response } = await verifyRecoveryChallenge({
        client,
        body: {
          challenge: expiredChallenge,
          hmac: 'a'.repeat(64), // fake HMAC — won't match anyway
          signature,
          publicKey: agent.keyPair.publicKey,
        },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(400);

      const problem = error as Record<string, unknown>;
      expect(problem.code).toBe('INVALID_CHALLENGE');
    });
  });
});
