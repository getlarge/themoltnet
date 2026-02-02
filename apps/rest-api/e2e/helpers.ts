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

import { randomUUID } from 'node:crypto';

import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import type { IdentityApi, OAuth2Api } from '@ory/client';
import type { FastifyInstance } from 'fastify';

import { HYDRA_PUBLIC_URL } from './setup.js';

export interface TestAgent {
  identityId: string;
  moltbookName: string;
  keyPair: KeyPair;
  clientId: string;
  clientSecret: string;
  accessToken: string;
}

/**
 * Create a fully-registered agent with a real OAuth2 token.
 * Uses UUID for guaranteed uniqueness across test runs.
 */
export async function createAgent(opts: {
  app: FastifyInstance;
  identityApi: IdentityApi;
  hydraAdminOAuth2: OAuth2Api;
  webhookApiKey: string;
  moltbookName?: string;
}): Promise<TestAgent> {
  const uniqueId = randomUUID();
  const moltbookName = opts.moltbookName ?? `e2e-${uniqueId}`;

  // 1. Generate Ed25519 keypair
  const keyPair = await cryptoService.generateKeyPair();

  // 2. Create identity in Kratos via admin API
  const { data: identity } = await opts.identityApi.createIdentity({
    createIdentityBody: {
      schema_id: 'moltnet_agent',
      traits: {
        moltbook_name: moltbookName,
        email: `${moltbookName}@e2e.themolt.net`,
        public_key: keyPair.publicKey,
        key_fingerprint: keyPair.fingerprint,
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

  // 3. Call after-registration webhook on the REST API
  //    (Kratos doesn't have webhook configured in self-hosted YAML,
  //     so we trigger it manually — this creates DB entry + Keto relations)
  const webhookResponse = await opts.app.inject({
    method: 'POST',
    url: '/hooks/kratos/after-registration',
    headers: { 'x-ory-api-key': opts.webhookApiKey },
    payload: {
      identity: {
        id: identityId,
        traits: {
          moltbook_name: moltbookName,
          public_key: keyPair.publicKey,
          key_fingerprint: keyPair.fingerprint,
        },
      },
    },
  });

  if (webhookResponse.statusCode !== 200) {
    throw new Error(
      `After-registration webhook failed: ${webhookResponse.statusCode} ${webhookResponse.body}`,
    );
  }

  // 4. Create OAuth2 client in Hydra via admin API
  const { data: oauthClient } = await opts.hydraAdminOAuth2.createOAuth2Client({
    oAuth2Client: {
      client_name: `${moltbookName} E2E Agent`,
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'diary:read diary:write crypto:sign agent:profile',
      metadata: {
        type: 'moltnet_agent',
        identity_id: identityId,
        moltbook_name: moltbookName,
        public_key: keyPair.publicKey,
        key_fingerprint: keyPair.fingerprint,
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
    moltbookName,
    keyPair,
    clientId: oauthClient.client_id,
    clientSecret: oauthClient.client_secret,
    accessToken: tokenData.access_token,
  };
}
