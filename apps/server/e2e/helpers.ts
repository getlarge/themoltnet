/**
 * E2E Test Helpers
 *
 * Creates real agents through the full registration pipeline:
 * 1. Generate Ed25519 keypair
 * 2. Create Kratos identity (admin API)
 * 3. Call after-registration webhook → DB + Keto
 * 4. Create Hydra OAuth2 client with agent metadata
 * 5. Acquire access token via client_credentials
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import { agentVouchers, type Database } from '@moltnet/database';
import type { IdentityApi, OAuth2Api } from '@ory/client';

import { HYDRA_PUBLIC_URL } from './setup.js';

export interface TestAgent {
  identityId: string;
  keyPair: KeyPair;
  clientId: string;
  clientSecret: string;
  accessToken: string;
}

/**
 * Create a voucher code directly in the database for E2E tests.
 * Bypasses the normal "issue via authenticated agent" flow.
 */
export async function createTestVoucher(opts: {
  db: Database;
  issuerId: string;
}): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now

  await opts.db.insert(agentVouchers).values({
    code,
    issuerId: opts.issuerId,
    expiresAt,
    redeemedAt: null,
    redeemedBy: null,
  });

  return code;
}

/**
 * Create a fully-registered agent with a real OAuth2 token.
 * Uses UUID for guaranteed uniqueness across test runs.
 * Requires a valid voucher code for registration.
 */
export async function createAgent(opts: {
  baseUrl: string;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  webhookApiKey: string;
  voucherCode: string;
}): Promise<TestAgent> {
  const uniqueId = randomUUID();

  // 1. Generate Ed25519 keypair
  const keyPair = await cryptoService.generateKeyPair();

  // 2. Create identity in Kratos via admin API
  const { data: identity } = await opts.identityApi.createIdentity({
    createIdentityBody: {
      schema_id: 'moltnet_agent',
      traits: {
        public_key: keyPair.publicKey,
        voucher_code: opts.voucherCode,
      },
      credentials: {
        password: {
          config: {
            password: `e2e-password-${uniqueId}`,
          },
        },
      },
    },
  });

  const identityId = identity.id;

  // 3. Call after-registration webhook on the containerized server
  console.log(
    `[createAgent] Calling webhook at: ${opts.baseUrl}/hooks/kratos/after-registration`,
  );
  const webhookResponse = await fetch(
    `${opts.baseUrl}/hooks/kratos/after-registration`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ory-api-key': opts.webhookApiKey,
      },
      body: JSON.stringify({
        identity: {
          id: identityId,
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: opts.voucherCode,
          },
        },
      }),
    },
  );

  if (!webhookResponse.ok) {
    const body = await webhookResponse.text();
    throw new Error(
      `After-registration webhook failed: ${webhookResponse.status} ${body}`,
    );
  }

  // 4. Create OAuth2 client in Hydra via admin API
  const { data: oauthClient } = await opts.hydraAdminOAuth2.createOAuth2Client({
    oAuth2Client: {
      client_name: `E2E Agent ${uniqueId}`,
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

  if (!oauthClient.client_id || !oauthClient.client_secret) {
    throw new Error('Hydra did not return client_id/client_secret');
  }

  // 5. Acquire access token via client_credentials grant
  const tokenResponse = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: oauthClient.client_id,
      client_secret: oauthClient.client_secret,
      scope: 'diary:read diary:write crypto:sign agent:profile',
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(
      `Token acquisition failed: ${tokenResponse.status} ${body}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
  };

  return {
    identityId,
    keyPair,
    clientId: oauthClient.client_id,
    clientSecret: oauthClient.client_secret,
    accessToken: tokenData.access_token,
  };
}
