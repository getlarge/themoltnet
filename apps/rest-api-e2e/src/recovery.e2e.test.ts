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
  recoverAgentCredentials,
  requestRecoveryChallenge,
  verifyRecoveryChallenge,
} from '@moltnet/api-client';
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { cryptoService, openSealedEnvelope } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  KRATOS_PUBLIC_URL,
  type TestHarness,
} from './setup.js';

function requestOAuthToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
) {
  return fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: AGENT_OAUTH_SCOPES.join(' '),
    }),
  });
}

describe('Recovery Flow', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
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
        body: { publicKey: agent.keyPair.publicKey, purpose: 'identity' },
      });

      expect(error).toBeUndefined();
      expect(data!.challenge).toBeDefined();
      expect(data!.challenge).toContain('moltnet:recovery:');
      expect(data!.hmac).toBeDefined();
      expect(data!.hmac).toMatch(/^[a-f0-9]{64}$/); // hex SHA-256
    });

    it('returns a valid challenge even for unknown public key (anti-enumeration)', async () => {
      const unknownKeyPair = await cryptoService.generateKeyPair();

      const { data, error, response } = await requestRecoveryChallenge({
        client,
        body: { publicKey: unknownKeyPair.publicKey, purpose: 'identity' },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.challenge).toContain('moltnet:recovery:');
      expect(data!.hmac).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ── Verify Challenge ────────────────────────────────────────

  describe('POST /recovery/verify', () => {
    it('completes the full crypto recovery: challenge → sign → recovery code', async () => {
      // Step 1: Request challenge
      const { data: challengeData } = await requestRecoveryChallenge({
        client,
        body: { publicKey: agent.keyPair.publicKey, purpose: 'identity' },
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
        body: { publicKey: agent.keyPair.publicKey, purpose: 'identity' },
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
        kratosStatus = 200;
        kratosResponseData = kratosResponse as unknown as Record<
          string,
          unknown
        >;
      } catch (err: unknown) {
        // Ory SDK wraps non-2xx responses as ResponseError
        const response = (err as { response?: Response })?.response;
        if (response) {
          kratosStatus = response.status;
          kratosResponseData = (await response.json()) as Record<
            string,
            unknown
          >;
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
        body: { publicKey: agent.keyPair.publicKey, purpose: 'identity' },
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
        body: { publicKey: agent.keyPair.publicKey, purpose: 'identity' },
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
      const expiredChallenge = `moltnet:recovery:identity:${agent.keyPair.publicKey}:fake-nonce:${expiredTimestamp}`;

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

  describe('POST /recovery/credentials', () => {
    it('resolves and rotates a legacy UUID OAuth2 client', async () => {
      await harness.hydraAdminOAuth2.deleteOAuth2Client({
        id: agent.clientId,
      });
      const legacyClient = await harness.hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: {
          client_name: `Agent: ${agent.keyPair.fingerprint}`,
          grant_types: ['client_credentials'],
          response_types: [],
          token_endpoint_auth_method: 'client_secret_post',
          scope: AGENT_OAUTH_SCOPES.join(' '),
          metadata: {
            type: 'moltnet_agent',
            identity_id: agent.identityId,
            public_key: agent.keyPair.publicKey,
            fingerprint: agent.keyPair.fingerprint,
          },
        },
      });
      expect(legacyClient.client_id).toBeDefined();
      expect(legacyClient.client_secret).toBeDefined();
      const legacyClientId = legacyClient.client_id!;
      const previousSecret = legacyClient.client_secret!;
      const { data: challengeData, error: challengeError } =
        await requestRecoveryChallenge({
          client,
          body: {
            publicKey: agent.keyPair.publicKey,
            purpose: 'credentials',
          },
        });
      expect(challengeError).toBeUndefined();
      expect(challengeData).toBeDefined();

      const signature = await cryptoService.sign(
        challengeData!.challenge,
        agent.keyPair.privateKey,
      );
      const { data, error, response } = await recoverAgentCredentials({
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
      expect(data).toBeDefined();
      const replacementSecret = openSealedEnvelope(
        data!.sealedClientSecret,
        agent.keyPair.privateKey,
      );
      expect(data!.clientId).toBe(legacyClientId);
      expect(replacementSecret).not.toBe(previousSecret);

      await expect(
        requestOAuthToken(harness.baseUrl, data!.clientId, replacementSecret),
      ).resolves.toMatchObject({ status: 200 });
      await expect(
        requestOAuthToken(harness.baseUrl, legacyClientId, previousSecret),
      ).resolves.toMatchObject({ status: 401 });
    });
  });
});
