/**
 * E2E: Identity key rotation
 *
 * An agent signs with its registration key, rotates to a new key with a
 * dual-signed proof, and the test checks every place the key lives: Postgres
 * history (old signatures still verify), Kratos traits, Hydra client metadata,
 * token claims, and token revocation. Real Ory, real DBOS, real crypto.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  createSigningRequest,
  getAgentProfile,
  getWhoami,
  rotateIdentityKey,
  submitSignature,
  verifyAgentSignature,
  verifyDiaryEntryById,
} from '@moltnet/api-client';
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import {
  computeContentCid,
  cryptoService,
  type KeyPair,
} from '@moltnet/crypto-service';
import { buildIdentityKeyRotationMessage } from '@moltnet/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

async function requestToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: AGENT_OAUTH_SCOPES.join(' '),
    }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function signedProof(agentId: string, current: KeyPair, next: KeyPair) {
  const issuedAt = new Date().toISOString();
  const message = buildIdentityKeyRotationMessage({
    agentId,
    currentPublicKey: current.publicKey,
    newPublicKey: next.publicKey,
    issuedAt,
  });
  return {
    newPublicKey: next.publicKey,
    issuedAt,
    previousKeySignature: await cryptoService.sign(message, current.privateKey),
    newKeySignature: await cryptoService.sign(message, next.privateKey),
  };
}

describe('Identity key rotation', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;
  let oldFingerprint: string;
  let next: KeyPair;
  let signedEntryId: string;
  let oldSignature: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    oldFingerprint = cryptoService.getFingerprintFromPublicKey(
      agent.keyPair.publicKey,
    );
    next = await cryptoService.generateKeyPair();

    // A signed entry made with the registration key, before any rotation.
    const content = 'Signed before the identity key rotated';
    const contentCid = computeContentCid('semantic', 'Before', content, []);
    const { data: request } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    oldSignature = await cryptoService.signWithNonce(
      contentCid,
      request!.nonce,
      agent.keyPair.privateKey,
    );
    const { data: submitted } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: request!.id },
      body: { signature: oldSignature },
    });
    expect(submitted!.valid).toBe(true);
    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        title: 'Before',
        entryType: 'semantic',
        tags: [],
        contentHash: contentCid,
        signingRequestId: request!.id,
      },
    });
    signedEntryId = entry!.id;
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('rejects a proof the new key did not sign', async () => {
    const stranger = await cryptoService.generateKeyPair();
    const body = await signedProof(agent.agentId, agent.keyPair, next);
    const forged = await signedProof(agent.agentId, agent.keyPair, stranger);

    const { response } = await rotateIdentityKey({
      client,
      auth: () => agent.accessToken,
      body: { ...body, newKeySignature: forged.newKeySignature },
    });

    expect(response.status).toBe(400);
  });

  it('rotates the key everywhere and keeps old signatures verifiable', async () => {
    const oldToken = agent.accessToken;

    const { data, error, response } = await rotateIdentityKey({
      client,
      auth: () => oldToken,
      body: await signedProof(agent.agentId, agent.keyPair, next),
    });

    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data).toEqual({
      agentId: agent.agentId,
      publicKey: next.publicKey,
      fingerprint: next.fingerprint,
      previousFingerprint: oldFingerprint,
    });

    // Tokens issued before the rotation carry the old key and are revoked.
    const { response: staleWhoami } = await getWhoami({
      client,
      auth: () => oldToken,
    });
    expect(staleWhoami.status).toBe(401);

    // The client secret is unchanged; a fresh token names the new key.
    const freshToken = await requestToken(
      harness.baseUrl,
      agent.clientId,
      agent.clientSecret,
    );
    const { data: whoami } = await getWhoami({
      client,
      auth: () => freshToken,
    });
    expect(whoami).toMatchObject({
      publicKey: next.publicKey,
      fingerprint: next.fingerprint,
    });

    // Ory now names the new key.
    const identity = await harness.identityApi.getIdentity({
      id: agent.identityId,
    });
    expect((identity.traits as { public_key?: string }).public_key).toBe(
      next.publicKey,
    );
    const hydraClient = await harness.hydraAdminOAuth2.getOAuth2Client({
      id: agent.clientId,
    });
    expect(hydraClient.metadata).toMatchObject({
      public_key: next.publicKey,
      fingerprint: next.fingerprint,
    });

    // The entry signed with the retired key still verifies, attributed to it.
    const { data: verification } = await verifyDiaryEntryById({
      client,
      auth: () => freshToken,
      path: { entryId: signedEntryId },
    });
    expect(verification).toMatchObject({
      valid: true,
      signatureValid: true,
      agentFingerprint: oldFingerprint,
    });

    // The retired fingerprint still resolves, and its signatures verify.
    const { data: profile } = await getAgentProfile({
      client,
      path: { fingerprint: oldFingerprint },
    });
    expect(profile).toMatchObject({ fingerprint: next.fingerprint });
    const { data: publicVerify } = await verifyAgentSignature({
      client,
      path: { fingerprint: oldFingerprint },
      body: { signature: oldSignature },
    });
    expect(publicVerify).toEqual({
      valid: true,
      signer: { fingerprint: oldFingerprint },
    });

    // New signatures are made with the new key.
    const { data: request } = await createSigningRequest({
      client,
      auth: () => freshToken,
      body: { message: 'after rotation' },
    });
    const { data: submitted } = await submitSignature({
      client,
      auth: () => freshToken,
      path: { id: request!.id },
      body: {
        signature: await cryptoService.signWithNonce(
          'after rotation',
          request!.nonce,
          next.privateKey,
        ),
      },
    });
    expect(submitted!.valid).toBe(true);
  });

  it('refuses to rotate back to a retired key', async () => {
    const freshToken = await requestToken(
      harness.baseUrl,
      agent.clientId,
      agent.clientSecret,
    );

    const { response } = await rotateIdentityKey({
      client,
      auth: () => freshToken,
      body: await signedProof(agent.agentId, next, agent.keyPair),
    });

    expect(response.status).toBe(409);
  });
});
