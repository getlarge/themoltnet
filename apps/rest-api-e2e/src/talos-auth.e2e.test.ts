/**
 * E2E: Talos-issued API keys through the real REST authentication chokepoint.
 */

import { createClient, getWhoami } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Talos API key authentication', () => {
  let harness: TestHarness;
  let agent: TestAgent;
  let keyId: string;
  let secret: string;
  let revoked = false;

  beforeAll(async () => {
    harness = await createTestHarness();
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    const issued = await harness.oryClients.apiKeys?.adminIssueApiKey({
      issueApiKeyRequest: {
        actor_id: agent.identityId,
        name: 'rest-api-e2e',
        scopes: ['agent:profile'],
        ttl: '10m',
        visibility: 'KEY_VISIBILITY_SECRET',
        metadata: {
          subject_type: 'agent',
          team_id: agent.personalTeamId,
        },
      },
    });
    if (!issued?.issued_api_key?.key_id || !issued.secret) {
      throw new Error('Talos did not return an issued key and secret');
    }
    keyId = issued.issued_api_key.key_id;
    secret = issued.secret;
  });

  afterAll(async () => {
    if (keyId && !revoked) {
      await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
        keyId,
        adminRevokeIssuedApiKeyBody: {
          reason: 'REVOCATION_REASON_KEY_COMPROMISE',
        },
      });
    }
    await harness?.teardown();
  });

  it('maps a valid key to the canonical MoltNet agent', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });

    const { data, error, response } = await getWhoami({
      client,
      auth: () => secret,
    });

    expect(response.status).toBe(200);
    expect(error).toBeUndefined();
    expect(data).toMatchObject({
      identityId: agent.identityId,
      fingerprint: agent.keyPair.fingerprint,
      clientId: keyId,
    });
  });

  it('rejects the same key immediately after revocation', async () => {
    await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
      keyId,
      adminRevokeIssuedApiKeyBody: {
        reason: 'REVOCATION_REASON_KEY_COMPROMISE',
      },
    });
    revoked = true;

    const client = createClient({ baseUrl: harness.baseUrl });
    const { data, error, response } = await getWhoami({
      client,
      auth: () => secret,
    });

    expect(response.status).toBe(401);
    expect(data).toBeUndefined();
    expect(error).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
