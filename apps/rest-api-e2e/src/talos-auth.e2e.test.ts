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
  const issueIdempotencyKey = 'rest-api-e2e-agent-key';
  let harness: TestHarness;
  let agent: TestAgent;
  let keyId: string;
  let secret: string;
  let activeKeyId: string | null = null;
  const paginationKeyIds: string[] = [];

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
      headers: {
        'idempotency-key': issueIdempotencyKey,
        'x-moltnet-team-id': agent.personalTeamId,
      },
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

  it('prevents duplicate issue after a lost response', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });
    const replay = await createAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: {
        'idempotency-key': issueIdempotencyKey,
        'x-moltnet-team-id': agent.personalTeamId,
      },
      body: {
        agentId: agent.identityId,
        name: 'rest-api-e2e',
        ttlDays: 1,
      },
    });

    expect(replay.response.status).toBe(409);
    expect(replay.error).toMatchObject({ code: 'CONFLICT' });

    const listed = await listAgentKeys({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      query: { agentId: agent.identityId, limit: 100 },
    });
    expect(listed.response.status).toBe(200);
    expect(listed.data?.items.filter((key) => key.id === keyId)).toHaveLength(
      1,
    );
  });

  it('continues filtered lists with the native Talos cursor', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });
    for (const suffix of ['a', 'b']) {
      const created = await createAgentKey({
        client,
        auth: () => agent.accessToken,
        headers: {
          'idempotency-key': `rest-api-e2e-pagination-${suffix}`,
          'x-moltnet-team-id': agent.personalTeamId,
        },
        body: {
          agentId: agent.identityId,
          name: `rest-api-e2e-pagination-${suffix}`,
          ttlDays: 1,
        },
      });
      expect(created.response.status).toBe(201);
      paginationKeyIds.push(created.data!.key.id);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const listed = await listAgentKeys({
        client,
        auth: () => agent.accessToken,
        headers: { 'x-moltnet-team-id': agent.personalTeamId },
        query: {
          agentId: agent.identityId,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        },
      });
      expect(listed.response.status).toBe(200);
      for (const key of listed.data?.items ?? []) seen.add(key.id);
      cursor = listed.data?.nextCursor ?? undefined;
      if (!cursor) break;
    }

    expect([...seen]).toEqual(
      expect.arrayContaining([keyId, ...paginationKeyIds]),
    );
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
    for (const paginationKeyId of paginationKeyIds) {
      await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
        keyId: paginationKeyId,
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
    const selfRotation = await rotateAgentKey({
      client,
      auth: () => secret,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      path: { keyId },
    });
    expect(selfRotation.response.status).toBe(409);

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
