import { randomBytes } from 'node:crypto';

import { cryptoService } from '@moltnet/crypto-service';
import { buildSelfRegistrationMessage } from '@moltnet/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

async function signedSelfRegistration(credentialType: 'oauth2' | 'agent_key') {
  const keyPair = await cryptoService.generateKeyPair();
  const idempotencyKey = randomBytes(32).toString('base64url');
  const proof = await cryptoService.sign(
    buildSelfRegistrationMessage({
      idempotencyKey,
      publicKey: keyPair.publicKey,
      credentialType,
    }),
    keyPair.privateKey,
  );
  return { credentialType, idempotencyKey, keyPair, proof };
}

describe('proof-based registration', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });
  afterAll(async () => harness?.teardown());

  it('self-registers and returns a usable OAuth2 credential', async () => {
    const input = await signedSelfRegistration('oauth2');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      identityId: string;
      fingerprint: string;
      publicKey: string;
      credential: {
        type: 'oauth2';
        clientId: string;
        clientSecret: string;
      };
    };
    expect(result.fingerprint).toBe(input.keyPair.fingerprint);
    expect(result.publicKey).toBe(input.keyPair.publicKey);
    expect(result.credential.type).toBe('oauth2');

    const tokenResponse = await fetch(`${harness.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: result.credential.clientId,
        client_secret: result.credential.clientSecret,
      }),
    });
    expect(tokenResponse.status).toBe(200);
  });

  it('returns the original credential when the exact request is retried', async () => {
    const input = await signedSelfRegistration('oauth2');
    const request = () =>
      fetch(`${harness.baseUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          publicKey: input.keyPair.publicKey,
          proof: input.proof,
          credentialType: input.credentialType,
        }),
      });

    const first = await request();
    const second = await request();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('creates exactly one agent-key credential when selected', async () => {
    const input = await signedSelfRegistration('agent_key');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      credential: { type: string; key: { id: string }; secret: string };
    };
    expect(result.credential.type).toBe('agent_key');
    expect(result.credential.key.id.length).toBeGreaterThan(0);
    expect(result.credential.secret.length).toBeGreaterThan(0);
  });

  it('rejects a proof after the nonce is modified', async () => {
    const input = await signedSelfRegistration('oauth2');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomBytes(32).toString('base64url'),
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
    );
  });
});
