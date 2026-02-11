/**
 * E2E: Self-Service Registration Flow
 *
 * Tests the full Kratos self-service registration path that agents
 * use in production — NOT the admin API shortcut. Covers:
 *
 * 1. Schema selection (identity_schema=moltnet_agent)
 * 2. Registration with Ed25519 public key + voucher code
 * 3. Webhook interruption (can_interrupt: true) on invalid voucher
 * 4. Webhook sets metadata_public with fingerprint (response.parse: true)
 * 5. Session creation after successful registration
 * 6. Webhook error messages propagate to the caller
 */

import { randomUUID } from 'node:crypto';

import { createClient, getAgentProfile } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import type { RegistrationFlow } from '@ory/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestVoucher } from './helpers.js';
import {
  createTestHarness,
  HYDRA_PUBLIC_URL,
  type TestHarness,
} from './setup.js';

/**
 * Extract UI messages from a Kratos error response.
 * Kratos returns the updated flow with ui.messages or ui.nodes[].messages
 * when a webhook interrupts registration.
 */
function extractFlowMessages(
  data: unknown,
): { id: number; text: string; type: string }[] {
  const flow = data as RegistrationFlow;
  const messages: { id: number; text: string; type: string }[] = [];

  // Top-level flow messages
  if (flow?.ui?.messages) {
    for (const msg of flow.ui.messages) {
      messages.push({ id: msg.id, text: msg.text, type: msg.type });
    }
  }

  // Per-node messages (tied to specific input fields)
  if (flow?.ui?.nodes) {
    for (const node of flow.ui.nodes) {
      if (node.messages) {
        for (const msg of node.messages) {
          messages.push({ id: msg.id, text: msg.text, type: msg.type });
        }
      }
    }
  }

  return messages;
}

describe('Self-Service Registration', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Happy Path ──────────────────────────────────────────────

  it('registers an agent via self-service flow with schema selection', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    const password = `self-service-${randomUUID()}`;

    // Start registration flow with explicit schema selection
    const { data: flow } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    expect(flow.id).toBeDefined();

    // Submit registration
    const { data: registration } =
      await harness.kratosPublicFrontend.updateRegistrationFlow({
        flow: flow.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password,
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: voucherCode,
          },
        },
      });

    // Identity created with correct traits
    expect(registration.identity).toBeDefined();
    expect(registration.identity.id).toBeDefined();
    expect(registration.identity.traits.public_key).toBe(keyPair.publicKey);

    // Webhook set metadata_public via response.parse
    expect(registration.identity.metadata_public).toBeDefined();
    const metadata = registration.identity.metadata_public as {
      fingerprint: string;
      public_key: string;
    };
    expect(metadata.fingerprint).toBe(keyPair.fingerprint);
    expect(metadata.public_key).toBe(keyPair.publicKey);

    // Session was created (session hook fires after webhook)
    expect(registration.session).toBeDefined();
    expect(registration.session_token).toBeDefined();
  });

  // ── Webhook Error Propagation ──────────────────────────────

  it('rejects registration with invalid voucher and propagates error message', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const password = `self-service-${randomUUID()}`;

    const { data: flow } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    try {
      await harness.kratosPublicFrontend.updateRegistrationFlow({
        flow: flow.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password,
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: 'invalid-voucher-does-not-exist',
          },
        },
      });
      expect.unreachable('Registration should have been rejected');
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { status: number; data: unknown };
      };
      expect(axiosError.response).toBeDefined();
      // Kratos returns 422 when a webhook interrupts the flow
      expect([400, 422]).toContain(axiosError.response!.status);

      // Verify webhook error messages propagated through Kratos
      const messages = extractFlowMessages(axiosError.response!.data);
      const errorMessages = messages.filter((m) => m.type === 'error');
      expect(errorMessages.length).toBeGreaterThan(0);

      // The voucher validation error should mention voucher
      const voucherError = errorMessages.find((m) =>
        m.text.toLowerCase().includes('voucher'),
      );
      expect(voucherError).toBeDefined();
    }
  });

  it('rejects registration with invalid public key and propagates error message', async () => {
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    const password = `self-service-${randomUUID()}`;

    const { data: flow } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    try {
      await harness.kratosPublicFrontend.updateRegistrationFlow({
        flow: flow.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password,
          traits: {
            public_key: 'not-ed25519-format',
            voucher_code: voucherCode,
          },
        },
      });
      expect.unreachable('Registration should have been rejected');
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { status: number; data: unknown };
      };
      expect(axiosError.response).toBeDefined();
      expect([400, 422]).toContain(axiosError.response!.status);

      // Verify webhook error messages propagated
      const messages = extractFlowMessages(axiosError.response!.data);
      const errorMessages = messages.filter((m) => m.type === 'error');
      expect(errorMessages.length).toBeGreaterThan(0);

      // The public key validation error should mention ed25519
      const keyError = errorMessages.find((m) =>
        m.text.toLowerCase().includes('ed25519'),
      );
      expect(keyError).toBeDefined();
    }
  });

  it('rejects registration with already-used voucher', async () => {
    // Create and use a voucher via the first registration
    const keyPair1 = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const { data: flow1 } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    await harness.kratosPublicFrontend.updateRegistrationFlow({
      flow: flow1.id,
      updateRegistrationFlowBody: {
        method: 'password',
        password: `self-service-${randomUUID()}`,
        traits: {
          public_key: keyPair1.publicKey,
          voucher_code: voucherCode,
        },
      },
    });

    // Try to reuse the same voucher with a different keypair
    const keyPair2 = await cryptoService.generateKeyPair();
    const { data: flow2 } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    try {
      await harness.kratosPublicFrontend.updateRegistrationFlow({
        flow: flow2.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password: `self-service-${randomUUID()}`,
          traits: {
            public_key: keyPair2.publicKey,
            voucher_code: voucherCode,
          },
        },
      });
      expect.unreachable('Second registration should have been rejected');
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { status: number; data: unknown };
      };
      expect(axiosError.response).toBeDefined();
      expect([400, 422]).toContain(axiosError.response!.status);
    }
  });

  // ── Full Agent Lifecycle ────────────────────────────────────

  it('self-service registered agent can be looked up by fingerprint', async () => {
    const keyPair = await cryptoService.generateKeyPair();
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const { data: flow } =
      await harness.kratosPublicFrontend.createNativeRegistrationFlow({
        identitySchema: 'moltnet_agent',
      });

    const { data: registration } =
      await harness.kratosPublicFrontend.updateRegistrationFlow({
        flow: flow.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password: `self-service-${randomUUID()}`,
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: voucherCode,
          },
        },
      });

    const identityId = registration.identity.id;

    // Create OAuth2 client + get token (mirrors production DCR flow)
    const { data: oauthClient } =
      await harness.hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: {
          client_name: `E2E Self-Service ${randomUUID()}`,
          grant_types: ['client_credentials'],
          response_types: [],
          token_endpoint_auth_method: 'client_secret_post',
          scope: 'diary:read diary:write crypto:sign agent:profile',
          metadata: {
            type: 'moltnet_agent',
            identity_id: identityId,
            public_key: keyPair.publicKey,
            fingerprint: keyPair.fingerprint,
          },
        },
      });

    const tokenResponse = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: oauthClient.client_id!,
        client_secret: oauthClient.client_secret!,
        scope: 'diary:read diary:write crypto:sign agent:profile',
      }),
    });
    expect(tokenResponse.ok).toBe(true);

    // Agent profile is accessible via REST API
    const client = createClient({ baseUrl: harness.baseUrl });
    const { data: profile } = await getAgentProfile({
      client,
      path: { fingerprint: keyPair.fingerprint },
    });

    expect(profile).toBeDefined();
    expect(profile!.fingerprint).toBe(keyPair.fingerprint);
    expect(profile!.publicKey).toBe(keyPair.publicKey);
  });
});
