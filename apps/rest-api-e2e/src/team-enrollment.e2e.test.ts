import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { createAgentKeyService } from '@moltnet/agent-key-service';
import {
  type Client,
  type ConflictProblemDetails,
  createAgentKey,
  createClient,
  createTeam,
  createTeamInvite,
  deleteTeamInvite,
  getTeam,
  getWhoami,
  joinTeam,
  revokeAgentKey,
} from '@moltnet/api-client';
import {
  AGENT_CREDENTIAL_SCOPES,
  createPermissionChecker,
  createRelationshipReader,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import { createAgentRepository, teamInvites, teams } from '@moltnet/database';
import { buildTeamEnrollmentMessage } from '@moltnet/models';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAgent,
  createHuman,
  type TestAgent,
  type TestHuman,
} from './helpers.js';
import { createTestHarness, DATABASE_URL, type TestHarness } from './setup.js';

let harness: TestHarness;
let client: Client;
let owner: TestAgent;
let agent: TestAgent;
let human: TestHuman;
let joinSecret: string;

beforeAll(async () => {
  harness = await createTestHarness();
  client = createClient({ baseUrl: harness.baseUrl });
  const options = {
    baseUrl: harness.baseUrl,
    db: harness.db,
    bootstrapIdentityId: harness.bootstrapIdentityId,
  };
  owner = await createAgent(options);
  agent = await createAgent(options);
  human = await createHuman({
    kratosPublicFrontend: harness.kratosPublicFrontend,
  });
  const issued = await createAgentKey({
    client,
    auth: () => agent.accessToken,
    headers: {
      'idempotency-key': randomUUID(),
      'x-moltnet-team-id': agent.personalTeamId,
    },
    body: { agentId: agent.agentId, name: 'join-only', scopes: ['team:join'] },
  });
  expect(issued.response.status).toBe(201);
  joinSecret = issued.data!.secret;
});
afterAll(async () => {
  await harness?.teardown();
});

async function invitation() {
  const team = await createTeam({
    client,
    auth: () => owner.accessToken,
    body: { name: `Enrollment ${randomUUID()}` },
  });
  expect(team.response.status).toBe(201);
  const invite = await createTeamInvite({
    client,
    auth: () => owner.accessToken,
    path: { id: team.data!.id },
    body: { role: 'member' },
  });
  expect(invite.response.status).toBe(201);
  return { teamId: team.data!.id, ...invite.data! };
}
function enroll(
  code: string,
  idempotencyKey = randomUUID(),
  auth = joinSecret,
  selectedClient = client,
) {
  return joinTeam({
    client: selectedClient,
    auth: () => auth,
    headers: { 'idempotency-key': idempotencyKey },
    body: { code, issueAgentKey: true },
  });
}
async function usage(inviteId: string) {
  const [invite] = await harness.db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.id, inviteId));
  return invite?.usedAt instanceof Date;
}
async function talosKeys(agentId: string, teamId: string) {
  const response = await harness.oryClients.apiKeys!.adminListIssuedApiKeys({
    filter: `actor_id="${agentId}"`,
    pageSize: 100,
  });
  return (response.issued_api_keys ?? []).filter(
    (key) =>
      (key.metadata as { team_id?: string } | undefined)?.team_id === teamId,
  );
}

// Run the real membership workflow without issuing a key, as if the HTTP
// process stopped between its durable membership result and the Talos request.
async function prepareOwnerMembership(
  invite: { id: string; code: string },
  idempotencyKey: string,
) {
  const latestVersion = async () => {
    const result = await harness.db.execute<{ version_name: string }>(sql`
      SELECT version_name FROM dbos.application_versions
      ORDER BY version_timestamp DESC LIMIT 1
    `);
    expect(result.rows).toHaveLength(1);
    return result.rows[0].version_name;
  };
  const apiVersion = await latestVersion();
  const root = resolve(import.meta.dirname, '../../..');
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve(
        root,
        'apps/rest-api-e2e/src/fixtures/team-invite-recovery.worker.ts',
      ),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        INVITE_TEST_DATABASE_URL: DATABASE_URL,
        INVITE_TEST_LATEST_VERSION: apiVersion,
        INVITE_TEST_INPUT: JSON.stringify({
          inviteId: invite.id,
          subjectId: owner.agentId,
          subjectNs: 'Agent',
          enrollment: {
            idempotencyKey,
            codeHash: createHash('sha256').update(invite.code).digest('hex'),
          },
        }),
      },
      timeout: 60_000,
    },
  );
  expect(await latestVersion()).toBe(apiVersion);
}

describe('team enrollment', () => {
  it('enrolls the existing agent with a join-only key and isolates its destination grant', async () => {
    const invite = await invitation();
    const result = await enroll(invite.code);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    const key = result.data!.agentKey!;
    expect(key.key).toMatchObject({
      agentId: agent.agentId,
      bindingScope: 'team',
      teamId: invite.teamId,
    });
    expect(key.key.scopes?.sort()).toEqual([...AGENT_CREDENTIAL_SCOPES].sort());
    expect(
      (
        await getTeam({
          client,
          auth: () => key.secret,
          path: { id: invite.teamId },
          headers: { 'x-moltnet-team-id': invite.teamId },
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await getTeam({
          client,
          auth: () => key.secret,
          path: { id: agent.personalTeamId },
          headers: { 'x-moltnet-team-id': agent.personalTeamId },
        })
      ).response.status,
    ).toBe(403);
    expect(await usage(invite.id)).toBe(true);
    const checkpoints = await harness.db.execute(
      sql`SELECT to_jsonb(s) AS row FROM dbos.workflow_status s WHERE workflow_uuid LIKE ${`team-enrollment:${agent.agentId}:%`}`,
    );
    expect(JSON.stringify(checkpoints.rows)).not.toContain(key.secret);
    expect(JSON.stringify(checkpoints.rows)).not.toContain(invite.code);
    const outputs = await harness.db.execute(
      sql`SELECT to_jsonb(o) AS row FROM dbos.operation_outputs o WHERE workflow_uuid LIKE ${`team-enrollment:${agent.agentId}:%`}`,
    );
    expect(outputs.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(outputs.rows)).not.toContain(key.secret);
    expect(JSON.stringify(outputs.rows)).not.toContain(invite.code);
  });

  it('deduplicates concurrent calls and rejects replay and conflicting input', async () => {
    const invite = await invitation();
    const idempotencyKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => enroll(invite.code, idempotencyKey)),
    );
    expect(results.map((r) => r.response.status).sort()).toEqual([
      200, 409, 409, 409,
    ]);
    expect(await usage(invite.id)).toBe(true);
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(1);
    expect((await enroll(invite.code, randomUUID())).response.status).toBe(410);
    const another = await invitation();
    expect((await enroll(another.code, idempotencyKey)).response.status).toBe(
      409,
    );
    expect(await usage(another.id)).toBe(false);
    await deleteTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: invite.teamId, inviteId: invite.id },
    });
    expect((await enroll(invite.code, idempotencyKey)).response.status).toBe(
      409,
    );
  });

  it('consumes one use when the same agent races different request keys', async () => {
    const invite = await invitation();
    const results = await Promise.all([
      enroll(invite.code),
      enroll(invite.code),
    ]);
    expect(results.map((result) => result.response.status).sort()).toEqual([
      200, 410,
    ]);
    expect(await usage(invite.id)).toBe(true);
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(1);
  });

  it('resumes an accepted claim after its invitation has been deleted', async () => {
    const invite = await invitation();
    const idempotencyKey = randomUUID();
    await prepareOwnerMembership(invite, idempotencyKey);
    await deleteTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: invite.teamId, inviteId: invite.id },
    });
    const result = await enroll(invite.code, idempotencyKey, owner.accessToken);
    expect(result.response.status).toBe(200);
    expect(await talosKeys(owner.agentId, invite.teamId)).toHaveLength(1);
  });

  it('preserves an existing owner role while consuming a fresh invitation', async () => {
    const invite = await invitation();
    const result = await enroll(invite.code, randomUUID(), owner.accessToken);
    expect(result.response.status).toBe(200);
    expect(result.data!.role).toBe('owner');
    expect(await usage(invite.id)).toBe(true);
  });

  it('requires idempotency and rejects human issuance without consuming the invitation', async () => {
    const invite = await invitation();
    const missing = await joinTeam({
      client,
      auth: () => joinSecret,
      body: { code: invite.code, issueAgentKey: true },
    });
    expect(missing.response.status).toBe(400);
    const humanClient = createClient({ baseUrl: harness.baseUrl });
    humanClient.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', human.sessionToken);
      return request;
    });
    const denied = await joinTeam({
      client: humanClient,
      headers: { 'idempotency-key': randomUUID() },
      body: { code: invite.code, issueAgentKey: true },
    });
    expect(denied.response.status).toBe(403);
    expect(await usage(invite.id)).toBe(false);
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(0);
    const joined = await joinTeam({
      client: humanClient,
      body: { code: invite.code },
    });
    expect(joined.response.status).toBe(200);
    expect(Object.keys(joined.data!).sort()).toEqual(['role', 'teamId']);
  });

  it.each(['invalid', 'expired', 'exhausted', 'deleted', 'inactive'] as const)(
    'creates no credential for an %s invitation',
    async (kind) => {
      const invite = await invitation();
      if (kind === 'expired')
        await harness.db
          .update(teamInvites)
          .set({ expiresAt: new Date(0) })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'exhausted')
        await harness.db
          .update(teamInvites)
          .set({ usedAt: new Date() })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'deleted')
        await deleteTeamInvite({
          client,
          auth: () => owner.accessToken,
          path: { id: invite.teamId, inviteId: invite.id },
        });
      if (kind === 'inactive')
        await harness.db
          .update(teams)
          .set({ status: 'archived' })
          .where(eq(teams.id, invite.teamId));
      const result = await enroll(
        kind === 'invalid' ? randomUUID() : invite.code,
      );
      expect(result.response.status).toBe(
        {
          invalid: 404,
          expired: 410,
          exhausted: 410,
          deleted: 404,
          inactive: 400,
        }[kind],
      );
      expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(0);
      if (kind !== 'exhausted') expect(await usage(invite.id)).toBe(false);
    },
  );

  it('retries the durable grant after a failure before Talos creates a credential', async () => {
    const invite = await invitation();
    const idempotencyKey = randomUUID();
    await prepareOwnerMembership(invite, idempotencyKey);
    const api = harness.oryClients.apiKeys!;
    const service = createAgentKeyService({
      agentRepository: createAgentRepository(harness.db),
      permissionChecker: createPermissionChecker(harness.oryClients.permission),
      relationshipReader: createRelationshipReader(
        harness.oryClients.relationshipRead,
      ),
      talosApi: {
        adminIssueApiKey: async () => {
          throw new Error('injected failure before issuance');
        },
        adminGetIssuedApiKey: api.adminGetIssuedApiKey.bind(api),
        adminListIssuedApiKeys: api.adminListIssuedApiKeys.bind(api),
        adminRevokeIssuedApiKey: api.adminRevokeIssuedApiKey.bind(api),
        adminRotateIssuedApiKey: api.adminRotateIssuedApiKey.bind(api),
      },
    });
    await expect(
      service.issueEnrollment({
        grant: {
          inviteId: invite.id,
          agentId: owner.agentId,
          teamId: invite.teamId,
        },
        logger: { debug() {}, info() {}, warn() {} },
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(await talosKeys(owner.agentId, invite.teamId)).toHaveLength(0);
    expect(await usage(invite.id)).toBe(true);
    const retried = await enroll(
      invite.code,
      idempotencyKey,
      owner.accessToken,
    );
    expect(retried.response.status).toBe(200);
    expect(await talosKeys(owner.agentId, invite.teamId)).toHaveLength(1);
    expect(
      (await enroll(invite.code, idempotencyKey, owner.accessToken)).response
        .status,
    ).toBe(409);
    expect(await talosKeys(owner.agentId, invite.teamId)).toHaveLength(1);
  });

  it('returns 409 after a lost Talos issuance response without rotating or consuming again', async () => {
    const invite = await invitation();
    const idempotencyKey = randomUUID();
    await prepareOwnerMembership(invite, idempotencyKey);
    const grant = {
      inviteId: invite.id,
      agentId: owner.agentId,
      teamId: invite.teamId,
    };
    const api = harness.oryClients.apiKeys!;
    // The only injected fault: Talos commits its real issuance, but its response
    // is lost before the caller can save the key identifier or return the secret.
    const service = createAgentKeyService({
      agentRepository: createAgentRepository(harness.db),
      permissionChecker: createPermissionChecker(harness.oryClients.permission),
      relationshipReader: createRelationshipReader(
        harness.oryClients.relationshipRead,
      ),
      talosApi: {
        adminIssueApiKey: async (...args) => {
          await api.adminIssueApiKey(...args);
          throw new Error('injected lost Talos response');
        },
        adminGetIssuedApiKey: api.adminGetIssuedApiKey.bind(api),
        adminListIssuedApiKeys: api.adminListIssuedApiKeys.bind(api),
        adminRevokeIssuedApiKey: api.adminRevokeIssuedApiKey.bind(api),
        adminRotateIssuedApiKey: api.adminRotateIssuedApiKey.bind(api),
      },
    });
    const logger = { debug() {}, info() {}, warn() {} };
    await expect(
      service.issueEnrollment({ grant, logger }),
    ).rejects.toMatchObject({ statusCode: 502 });
    const original = await talosKeys(owner.agentId, invite.teamId);
    expect(original).toHaveLength(1);
    const replay = await enroll(invite.code, idempotencyKey, owner.accessToken);
    expect(replay.response.status).toBe(409);
    expect(replay.error).toMatchObject({
      conflict: {
        target: {
          resource: 'agent-key',
          keys: {
            keyId: original[0].key_id,
            subjectId: owner.agentId,
            teamId: invite.teamId,
          },
        },
      },
    });
    const after = await talosKeys(owner.agentId, invite.teamId);
    expect(after.map((k) => k.key_id)).toEqual(original.map((k) => k.key_id));
    expect(after[0].update_time).toEqual(original[0].update_time);
    const conflict = replay.error as ConflictProblemDetails;
    const keyId = conflict.conflict.target?.keys?.keyId;
    expect(keyId).toBe(original[0].key_id);
    const revoked = await revokeAgentKey({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': invite.teamId },
      path: { keyId: keyId! },
      body: { reason: 'key_compromise' },
    });
    expect(revoked.response.status).toBe(204);
    expect(await usage(invite.id)).toBe(true);
  });
});

describe('proof enrollment against API and Talos', () => {
  it('redeems a human-created Console invitation and renews after credential revocation', async () => {
    const consoleClient = createClient({ baseUrl: harness.baseUrl });
    consoleClient.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', human.sessionToken);
      return request;
    });
    const team = await createTeam({
      client: consoleClient,
      body: { name: `Desktop enrollment ${randomUUID()}` },
    });
    expect(team.response.status).toBe(201);
    const invite = await createTeamInvite({
      client: consoleClient,
      path: { id: team.data!.id },
      body: { role: 'executor' },
    });
    expect(invite.response.status).toBe(201);
    const original = await proofEnroll(invite.data!.code, team.data!.id);
    expect(original.response.status).toBe(200);
    const key = original.data!.agentKey!;
    const revoked = await revokeAgentKey({
      client: consoleClient,
      headers: { 'x-moltnet-team-id': team.data!.id },
      path: { keyId: key.key.id },
      body: { reason: 'key_compromise' },
    });
    expect(revoked.response.status).toBe(204);
    expect(
      (await getWhoami({ client, auth: () => key.secret })).response.status,
    ).toBe(401);
    const renewal = await createTeamInvite({
      client: consoleClient,
      path: { id: team.data!.id },
      body: { role: 'executor' },
    });
    expect(renewal.response.status).toBe(201);
    const replacement = await proofEnroll(renewal.data!.code, team.data!.id);
    expect(replacement.response.status).toBe(200);
    expect(
      (
        await getWhoami({
          client,
          auth: () => replacement.data!.agentKey!.secret,
        })
      ).response.status,
    ).toBe(200);
  });

  async function proofEnroll(
    code: string,
    expectedTeamId?: string,
    idempotencyKey = randomUUID(),
  ) {
    const input = {
      subjectId: agent.agentId,
      code,
      expectedTeamId,
      idempotencyKey,
    };
    const proof = await cryptoService.sign(
      buildTeamEnrollmentMessage(input),
      agent.keyPair.privateKey,
    );
    return joinTeam({
      client,
      headers: { 'idempotency-key': idempotencyKey },
      body: {
        code,
        expectedTeamId,
        issueAgentKey: true,
        proof: { subjectId: input.subjectId, signature: proof },
      },
    });
  }

  it('enrolls without API authentication, renews, and leaves the predecessor usable', async () => {
    const invite = await invitation();
    const original = await proofEnroll(invite.code);
    expect(original.response.status).toBe(200);
    const renewal = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: invite.teamId },
      body: { role: 'executor' },
    });
    expect(renewal.response.status).toBe(201);
    const idempotencyKey = randomUUID();
    const replacement = await proofEnroll(
      renewal.data!.code,
      invite.teamId,
      idempotencyKey,
    );
    expect(replacement.response.status).toBe(200);
    expect(replacement.data!.role).toBe('member');
    for (const credential of [
      original.data!.agentKey,
      replacement.data!.agentKey,
    ]) {
      const whoami = await getWhoami({ client, auth: () => credential.secret });
      expect(whoami.response.status).toBe(200);
      expect(whoami.data!.credentialBinding).toMatchObject({
        keyId: credential.key.id,
        bindingScope: 'team',
        boundTeamId: invite.teamId,
        expiresAt: credential.key.expiresAt,
      });
    }
    const replay = await proofEnroll(
      renewal.data!.code,
      invite.teamId,
      idempotencyKey,
    );
    expect(replay.response.status).toBe(409);
    expect(replay.error).toMatchObject({
      conflict: {
        target: { keys: { keyId: replacement.data!.agentKey!.key.id } },
      },
    });
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(2);
  });

  it('rejects wrong-team renewal without spending its invitation', async () => {
    const invite = await invitation();
    expect((await proofEnroll(invite.code, randomUUID())).response.status).toBe(
      409,
    );
    expect(await usage(invite.id)).toBe(false);
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(0);
    expect(
      (await proofEnroll(invite.code, invite.teamId)).response.status,
    ).toBe(200);
  });

  it('issues once under concurrent proof redemption', async () => {
    const invite = await invitation();
    const idempotencyKey = randomUUID();
    const responses = await Promise.all([
      proofEnroll(invite.code, invite.teamId, idempotencyKey),
      proofEnroll(invite.code, invite.teamId, idempotencyKey),
    ]);
    expect(responses.map((r) => r.response.status).sort()).toEqual([200, 409]);
    expect(await talosKeys(agent.agentId, invite.teamId)).toHaveLength(1);
  });
});
