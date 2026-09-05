/**
 * E2E: Agent-key lifecycle through the real REST authentication chokepoint.
 */

import {
  cancelTask,
  claimTask,
  createAgentKey,
  createClient,
  createDiary,
  createTask,
  createTeam,
  getWhoami,
  listAgentKeys,
  listDiaries,
  revokeAgentKey,
  rotateAgentKey,
  taskHeartbeat,
} from '@moltnet/api-client';
import { AGENT_CREDENTIAL_SCOPES, AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('agent keys', () => {
  const issueIdempotencyKey = 'rest-api-e2e-agent-key';
  let harness: TestHarness;
  let agent: TestAgent;
  let keyId: string;
  let secret: string;
  let activeKeyId: string | null = null;
  let diaryReadKeyId: string | null = null;
  let diaryReadSecret: string;
  let identityKeyId: string | null = null;
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
        scopes: [...AGENT_OAUTH_SCOPES],
        ttlDays: 1,
      },
    });
    if (error || !issued) {
      throw new Error(`MoltNet did not issue an agent key: ${String(error)}`);
    }
    keyId = issued.key.id;
    secret = issued.secret;
    activeKeyId = keyId;

    const { data: diaryReadKey, error: diaryReadKeyError } =
      await createAgentKey({
        client,
        auth: () => agent.accessToken,
        headers: {
          'idempotency-key': 'rest-api-e2e-agent-key-diary-read',
          'x-moltnet-team-id': agent.personalTeamId,
        },
        body: {
          agentId: agent.identityId,
          name: 'rest-api-e2e-diary-read',
          scopes: ['diary:read'],
          ttlDays: 1,
        },
      });
    if (diaryReadKeyError || !diaryReadKey) {
      throw new Error(
        `MoltNet did not issue a scoped agent key: ${JSON.stringify(diaryReadKeyError)}`,
      );
    }
    diaryReadKeyId = diaryReadKey.key.id;
    diaryReadSecret = diaryReadKey.secret;
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
        scopes: [...AGENT_OAUTH_SCOPES],
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
          scopes: [...AGENT_OAUTH_SCOPES],
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
    if (diaryReadKeyId) {
      await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
        keyId: diaryReadKeyId,
        adminRevokeIssuedApiKeyBody: {
          reason: 'REVOCATION_REASON_KEY_COMPROMISE',
        },
      });
    }
    if (identityKeyId) {
      await harness.oryClients.apiKeys?.adminRevokeIssuedApiKey({
        keyId: identityKeyId,
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

  it('enforces route scopes for a minimally scoped agent key', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });

    const allowed = await listDiaries({
      client,
      auth: () => diaryReadSecret,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
    });
    expect(allowed.response.status).toBe(200);
    expect(allowed.error).toBeUndefined();
    expect(allowed.data?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: agent.privateDiaryId }),
      ]),
    );

    const denied = await getWhoami({
      client,
      auth: () => diaryReadSecret,
    });
    expect(denied.response.status).toBe(403);
    expect(denied.data).toBeUndefined();
    expect(denied.error).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'Missing required scope: agent:profile',
    });
  });

  it('enforces the explicit team ceiling and management scope', async () => {
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
      auth: () => diaryReadSecret,
      body: { name: 'must-not-be-created' },
    });
    expect(createTeamResult.response.status).toBe(403);
    expect(createTeamResult.error).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'Missing required scope: team:manage',
    });
  });

  it('claims and heartbeats on the five-scope grant while staying a ceiling', async () => {
    // AGENT_CREDENTIAL_SCOPES covers the claim/heartbeat path and is a real
    // ceiling: it cannot cancel work or mint credentials.
    //
    // Deliberately NOT "the daemon hot path": host-capability diary signing
    // also runs on the daemon's own credential (libs/agent-runtime/src/
    // host-capabilities/local-seed-signer.ts calls crypto.signingRequests
    // get/submit, which require `crypto:sign`), and that scope is not in this
    // grant. Naming the wider guarantee here would assert something this test
    // does not check.
    const client = createClient({ baseUrl: harness.baseUrl });

    const { data: daemonKey, error: daemonKeyError } = await createAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: {
        'idempotency-key': 'rest-api-e2e-agent-key-daemon-scopes',
        'x-moltnet-team-id': agent.personalTeamId,
      },
      body: {
        agentId: agent.identityId,
        name: 'rest-api-e2e-daemon',
        scopes: [...AGENT_CREDENTIAL_SCOPES],
        ttlDays: 1,
      },
    });
    if (daemonKeyError || !daemonKey) {
      throw new Error(
        `MoltNet did not issue the daemon key: ${JSON.stringify(daemonKeyError)}`,
      );
    }
    const daemonSecret = daemonKey.secret;
    const teamHeaders = { 'x-moltnet-team-id': agent.personalTeamId };

    const task = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: teamHeaders,
      body: {
        taskType: 'freeform',
        title: 'Daemon scope ceiling',
        diaryId: agent.privateDiaryId,
        input: { brief: 'prove the five-scope daemon grant is sufficient' },
      },
    });
    expect(task.error).toBeUndefined();
    const taskId = task.data!.id;

    // task:claim
    const claimed = await claimTask({
      client,
      auth: () => daemonSecret,
      headers: teamHeaders,
      path: { id: taskId },
      body: { leaseTtlSec: 60 },
    });
    expect(claimed.response.status).toBe(200);
    expect(claimed.error).toBeUndefined();

    // task:execute
    const beat = await taskHeartbeat({
      client,
      auth: () => daemonSecret,
      headers: teamHeaders,
      path: { id: taskId, n: claimed.data!.attempt.attemptN },
      body: { leaseTtlSec: 60 },
    });
    expect(beat.response.status).toBe(200);
    expect(beat.error).toBeUndefined();

    // task:manage is deliberately absent from the daemon grant.
    const cancelled = await cancelTask({
      client,
      auth: () => daemonSecret,
      headers: teamHeaders,
      path: { id: taskId },
      body: { reason: 'must-not-be-cancellable' },
    });
    expect(cancelled.response.status).toBe(403);
    expect(cancelled.error).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'Missing required scope: task:manage',
    });

    // key:manage is deliberately absent: a leaked daemon key cannot bootstrap
    // a wider credential for itself.
    const escalation = await createAgentKey({
      client,
      auth: () => daemonSecret,
      headers: {
        'idempotency-key': 'rest-api-e2e-agent-key-escalation',
        ...teamHeaders,
      },
      body: {
        agentId: agent.identityId,
        name: 'must-not-be-issued',
        scopes: [...AGENT_OAUTH_SCOPES],
        ttlDays: 1,
      },
    });
    expect(escalation.response.status).toBe(403);
    expect(escalation.error).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'Missing required scope: key:manage',
    });
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

  it('uses one identity-scoped key across authorized teams and invalidates it immediately', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });
    const outsider = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    const [teamAResult, teamBResult, outsiderTeamResult] = await Promise.all([
      createTeam({
        client,
        auth: () => agent.accessToken,
        body: { name: `identity-key-a-${Date.now()}` },
      }),
      createTeam({
        client,
        auth: () => agent.accessToken,
        body: { name: `identity-key-b-${Date.now()}` },
      }),
      createTeam({
        client,
        auth: () => outsider.accessToken,
        body: { name: `identity-key-outsider-${Date.now()}` },
      }),
    ]);
    expect(teamAResult.error).toBeUndefined();
    expect(teamBResult.error).toBeUndefined();
    expect(outsiderTeamResult.error).toBeUndefined();
    const teamAId = teamAResult.data!.id;
    const teamBId = teamBResult.data!.id;
    const outsiderTeamId = outsiderTeamResult.data!.id;

    const [diaryAResult, diaryBResult] = await Promise.all([
      createDiary({
        client,
        auth: () => agent.accessToken,
        headers: { 'x-moltnet-team-id': teamAId },
        body: { name: 'identity-key-team-a', visibility: 'moltnet' },
      }),
      createDiary({
        client,
        auth: () => agent.accessToken,
        headers: { 'x-moltnet-team-id': teamBId },
        body: { name: 'identity-key-team-b', visibility: 'moltnet' },
      }),
    ]);
    expect(diaryAResult.error).toBeUndefined();
    expect(diaryBResult.error).toBeUndefined();

    const task = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': teamAId },
      body: {
        taskType: 'freeform',
        title: 'Identity-scoped key cross-team claim',
        diaryId: diaryAResult.data!.id,
        input: { brief: 'prove the credential follows its agent identity' },
      },
    });
    expect(task.error).toBeUndefined();

    const issued = await createAgentKey({
      client,
      auth: () => agent.accessToken,
      headers: { 'idempotency-key': 'rest-api-e2e-identity-agent-key' },
      body: {
        agentId: agent.identityId,
        bindingScope: 'identity',
        name: 'rest-api-e2e-identity',
        scopes: [...AGENT_OAUTH_SCOPES],
        ttlDays: 1,
      },
    });
    expect(issued.response.status).toBe(201);
    expect(issued.error).toBeUndefined();
    expect(issued.data?.key).toMatchObject({ bindingScope: 'identity' });
    identityKeyId = issued.data!.key.id;
    let identitySecret = issued.data!.secret;

    const identity = await getWhoami({
      client,
      auth: () => identitySecret,
    });
    expect(identity.response.status).toBe(200);
    expect(identity.data?.credentialBinding).toEqual({
      bindingScope: 'identity',
      keyId: identityKeyId,
    });

    const claimed = await claimTask({
      client,
      auth: () => identitySecret,
      headers: { 'x-moltnet-team-id': teamAId },
      path: { id: task.data!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(claimed.response.status).toBe(200);
    expect(claimed.error).toBeUndefined();

    const teamBRead = await listDiaries({
      client,
      auth: () => identitySecret,
      headers: { 'x-moltnet-team-id': teamBId },
    });
    expect(teamBRead.response.status).toBe(200);
    expect(teamBRead.data?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: diaryBResult.data!.id }),
      ]),
    );

    const outsiderRead = await listDiaries({
      client,
      auth: () => identitySecret,
      headers: { 'x-moltnet-team-id': outsiderTeamId },
    });
    expect(outsiderRead.response.status).toBe(403);

    const rotated = await rotateAgentKey({
      client,
      auth: () => agent.accessToken,
      path: { keyId: identityKeyId },
      query: { bindingScope: 'identity' },
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.error).toBeUndefined();

    const staleAfterRotation = await getWhoami({
      client,
      auth: () => identitySecret,
    });
    expect(staleAfterRotation.response.status).toBe(401);

    identityKeyId = rotated.data!.key.id;
    identitySecret = rotated.data!.secret;
    const activeAfterRotation = await listDiaries({
      client,
      auth: () => identitySecret,
      headers: { 'x-moltnet-team-id': teamBId },
    });
    expect(activeAfterRotation.response.status).toBe(200);

    const revoked = await revokeAgentKey({
      client,
      auth: () => agent.accessToken,
      path: { keyId: identityKeyId },
      query: { bindingScope: 'identity' },
      body: { reason: 'key_compromise' },
    });
    expect(revoked.response.status).toBe(204);
    identityKeyId = null;

    const staleAfterRevocation = await getWhoami({
      client,
      auth: () => identitySecret,
    });
    expect(staleAfterRevocation.response.status).toBe(401);
  });
});
