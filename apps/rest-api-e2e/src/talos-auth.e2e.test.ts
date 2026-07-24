/**
 * E2E: Talos-issued API keys through the real REST authentication chokepoint.
 */

import {
  createAgentKey,
  createClient,
  createTeam,
  getWhoami,
  listAgentKeys,
  revokeAgentKey,
  rotateAgentKey,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Talos API key authentication', () => {
  let harness: TestHarness;
  let agent: TestAgent;
  let keyId: string;
  let secret: string;
  let activeKeyId: string | null = null;

  beforeAll(async () => {
    harness = await createTestHarness();
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    const client = createClient({ baseUrl: harness.baseUrl });
    const { data: issued, error } = await createAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {
        agentId: agent.identityId,
        name: 'rest-api-e2e',
        ttlDays: 1,
      },
    });
    if (error || !issued) {
      throw new Error(`MoltNet did not issue an agent key: ${String(error)}`);
    }
    keyId = issued.key.id;
    secret = issued.secret;
    activeKeyId = keyId;
  });

  afterAll(async () => {
    if (activeKeyId) {
      await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
        keyId: activeKeyId,
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

  it('enforces the explicit team ceiling and fail-closed route policy', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });

    const matching = await listAgentKeys({
      client,
      auth: () => secret,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
    });
    expect(matching.response.status).toBe(200);
    expect(matching.data?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: keyId, teamId: agent.personalTeamId }),
      ]),
    );

    const missingTeam = await listAgentKeys({
      client,
      auth: () => secret,
      headers: undefined as never,
    });
    expect(missingTeam.response.status).toBe(400);

    const crossTeam = await listAgentKeys({
      client,
      auth: () => secret,
      headers: {
        'x-moltnet-team-id': 'bbbbbbbb-0000-4000-8000-000000000002',
      },
    });
    expect(crossTeam.response.status).toBe(403);

    const createTeamResult = await createTeam({
      client,
      auth: () => secret,
      body: { name: 'must-not-be-created' },
    });
    expect(createTeamResult.response.status).toBe(403);
  });

  it('rotates and revokes without exposing the Talos admin API', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });
    const rotated = await rotateAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      path: { keyId },
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.data?.key.id).not.toBe(keyId);
    expect(rotated.data?.secret).toBeTruthy();

    const oldCredential = await getWhoami({
      client,
      auth: () => secret,
    });
    expect(oldCredential.response.status).toBe(401);

    activeKeyId = rotated.data!.key.id;
    secret = rotated.data!.secret;
    const newCredential = await getWhoami({
      client,
      auth: () => secret,
    });
    expect(newCredential.response.status).toBe(200);

    const revoked = await revokeAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      path: { keyId: activeKeyId },
      body: { reason: 'key_compromise' },
    });
    expect(revoked.response.status).toBe(204);
    activeKeyId = null;

    const revokedCredential = await getWhoami({
      client,
      auth: () => secret,
    });
    expect(revokedCredential.response.status).toBe(401);
    expect(revokedCredential.data).toBeUndefined();
    expect(revokedCredential.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
