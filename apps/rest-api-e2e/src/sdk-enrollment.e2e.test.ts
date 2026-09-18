import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClient,
  createTeam,
  createTeamInvite,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import {
  connect as connectExplicit,
  readConfig,
  SecretProviderRegistry,
  updateConfig,
  updateConfigSection,
  writeConfig,
} from '@themoltnet/sdk';
import {
  connect,
  CredentialPersistenceError,
  enrollTeam,
  FileSecretProvider,
} from '@themoltnet/sdk/node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

let harness: TestHarness;
let agent: TestAgent;
let owner: TestAgent;
let root: string;

beforeAll(async () => {
  for (const name of [
    'MOLTNET_AGENT_KEY',
    'MOLTNET_AGENT_KEY_REF',
    'MOLTNET_CLIENT_ID',
    'MOLTNET_CLIENT_SECRET',
    'MOLTNET_CREDENTIALS_PATH',
  ])
    vi.stubEnv(name, '');
  harness = await createTestHarness();
  const options = {
    baseUrl: harness.baseUrl,
    db: harness.db,
    bootstrapIdentityId: harness.bootstrapIdentityId,
  };
  agent = await createAgent(options);
  owner = await createAgent(options);
  root = await mkdtemp(join(tmpdir(), 'sdk-team-enrollment-'));
});
afterAll(async () => {
  await harness?.teardown();
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function invitation() {
  const client = createClient({ baseUrl: harness.baseUrl });
  const team = await createTeam({
    client,
    auth: () => owner.accessToken,
    body: { name: `SDK ${randomUUID()}` },
  });
  expect(team.response.status).toBe(201);
  const invite = await createTeamInvite({
    client,
    auth: () => owner.accessToken,
    path: { id: team.data!.id },
    body: { role: 'member' },
  });
  expect(invite.response.status).toBe(201);
  return { teamId: team.data!.id, code: invite.data!.code };
}
async function localIdentity() {
  const dir = join(root, randomUUID());
  const secrets = join(dir, 'secrets');
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  const provider = new FileSecretProvider({ root: secrets, writable: true });
  await writeConfig(
    {
      subject_id: agent.agentId,
      subject_type: 'agent',
      registered_at: new Date().toISOString(),
      keys: {
        public_key: agent.keyPair.publicKey,
        fingerprint: agent.keyPair.fingerprint,
        private_key_ref: {
          provider: 'file',
          key: `identity/${agent.keyPair.fingerprint}/seed`,
        },
      },
      endpoints: { api: harness.baseUrl, mcp: harness.baseUrl + '/mcp' },
      oauth2: { client_id: agent.clientId, client_secret: agent.clientSecret },
      agent_key_refs: {},
    },
    dir,
  );
  const incoming = await connectExplicit({
    clientId: agent.clientId,
    clientSecret: agent.clientSecret,
    apiUrl: harness.baseUrl,
  });
  return { dir, provider, incoming };
}

describe('SDK team enrollment persistence and reconnect', () => {
  it('persists two independent team keys and reconnects without OAuth or fallback', async () => {
    const { dir, provider, incoming } = await localIdentity();
    const a = await invitation();
    const b = await invitation();
    const idempotencyKey = randomUUID();
    const first = await enrollTeam({
      agent: incoming,
      code: a.code,
      idempotencyKey,
      configDir: dir,
      secretProvider: provider,
    });
    const second = await enrollTeam({
      agent: incoming,
      code: b.code,
      idempotencyKey: randomUUID(),
      configDir: dir,
      secretProvider: provider,
    });
    await expect(
      enrollTeam({
        agent: incoming,
        code: a.code,
        idempotencyKey,
        configDir: dir,
        secretProvider: provider,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(first).not.toHaveProperty('secret');
    expect(first.reference.key).toBe(`agent-key/${agent.agentId}/${a.teamId}`);
    expect(second.reference.key).toBe(`agent-key/${agent.agentId}/${b.teamId}`);
    await updateConfig((config) => {
      delete config.oauth2;
      config.agent_key_ref = {
        provider: provider.name,
        key: `agent-key/${config.subject_id}`,
      };
    }, dir);
    const config = await readConfig(dir);
    expect(config?.agent_key_refs).toEqual({
      [a.teamId]: first.reference,
      [b.teamId]: second.reference,
    });
    expect(config?.agent_key_ref).toBeUndefined();
    // The completed replay retains request context, never a second secret.
    expect(await readdir(join(dir, 'credential-recovery'))).toHaveLength(1);
    const registry = new SecretProviderRegistry().register(provider);
    const connectionA = await connect({
      configDir: dir,
      teamId: a.teamId,
      apiUrl: harness.baseUrl,
      secretProviders: registry,
    });
    const connectionB = await connect({
      configDir: dir,
      teamId: b.teamId,
      apiUrl: harness.baseUrl,
      secretProviders: registry,
    });
    expect((await connectionA.teams.get(a.teamId)).id).toBe(a.teamId);
    expect((await connectionB.teams.get(b.teamId)).id).toBe(b.teamId);
    const ownerConnection = await connectExplicit({
      clientId: owner.clientId,
      clientSecret: owner.clientSecret,
      apiUrl: harness.baseUrl,
    });
    const diaryB = await ownerConnection.diaries.create(
      { name: 'SDK isolation', visibility: 'private' },
      { teamId: b.teamId },
    );
    expect(
      (await connectionB.diaries.get(diaryB.id, { teamId: b.teamId })).id,
    ).toBe(diaryB.id);
    await expect(
      connectionA.diaries.get(diaryB.id, { teamId: b.teamId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      connect({
        configDir: dir,
        apiUrl: harness.baseUrl,
        secretProviders: registry,
      }),
    ).rejects.toThrow('select a team');
    await provider.delete(first.reference.key);
    await expect(
      connect({
        configDir: dir,
        teamId: a.teamId,
        apiUrl: harness.baseUrl,
        secretProviders: registry,
      }),
    ).rejects.toThrow('Unable to resolve');
    expect((await connectionB.teams.get(b.teamId)).id).toBe(b.teamId);
  });

  it('keeps a protected recovery artifact after provider failure and reconnects after recovery', async () => {
    const { dir, provider, incoming } = await localIdentity();
    const invite = await invitation();
    const before = await readFile(join(dir, 'moltnet.json'), 'utf8');
    const failing = {
      name: provider.name,
      capabilities: provider.capabilities,
      read: provider.read.bind(provider),
      probe: provider.probe.bind(provider),
      write: async (_key: string, secret: string) => {
        throw new Error(`injected provider failure ${secret}`);
      },
    };
    const failure = await enrollTeam({
      agent: incoming,
      code: invite.code,
      idempotencyKey: randomUUID(),
      configDir: dir,
      secretProvider: failing,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialPersistenceError);
    const path = (failure as CredentialPersistenceError).recoveryPath!;
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const recovery = JSON.parse(await readFile(path, 'utf8')) as {
      reference: { provider: string; key: string };
      secret: string;
      teamId: string;
      subjectId: string;
    };
    expect(recovery).toMatchObject({
      teamId: invite.teamId,
      subjectId: agent.agentId,
    });
    expect(String(failure)).not.toContain(recovery.secret);
    expect(JSON.stringify(failure)).not.toContain(recovery.secret);
    expect(await readFile(join(dir, 'moltnet.json'), 'utf8')).toBe(before);
    await provider.write(recovery.reference.key, recovery.secret);
    await updateConfigSection(
      'agent_key_refs',
      { [invite.teamId]: recovery.reference },
      dir,
    );
    await updateConfig((config) => {
      delete config.oauth2;
      config.agent_key_ref = {
        provider: provider.name,
        key: `agent-key/${config.subject_id}`,
      };
    }, dir);
    const reconnected = await connect({
      configDir: dir,
      teamId: invite.teamId,
      apiUrl: harness.baseUrl,
      secretProviders: new SecretProviderRegistry().register(provider),
    });
    expect((await reconnected.teams.get(invite.teamId)).id).toBe(invite.teamId);
  });
});

it('persists proof enrollment and renewal without any usable API credential', async () => {
  const { dir, provider } = await localIdentity();
  await updateConfig((config) => {
    delete config.oauth2;
    config.agent_key_ref = {
      provider: provider.name,
      key: `agent-key/${config.subject_id}`,
    };
  }, dir);
  const invite = await invitation();
  const signer = {
    sign: (message: string) =>
      cryptoService.sign(message, agent.keyPair.privateKey),
  };
  const original = await enrollTeam({
    signer,
    code: invite.code,
    idempotencyKey: randomUUID(),
    configDir: dir,
    secretProvider: provider,
  });
  const predecessor = await provider.read(original.reference.key);
  const client = createClient({ baseUrl: harness.baseUrl });
  const renewal = await createTeamInvite({
    client,
    auth: () => owner.accessToken,
    path: { id: invite.teamId },
    body: { role: 'member' },
  });
  expect(renewal.response.status).toBe(201);
  const replacement = await enrollTeam({
    signer,
    replacement: { teamId: invite.teamId },
    code: renewal.data!.code,
    idempotencyKey: randomUUID(),
    configDir: dir,
    secretProvider: provider,
  });
  expect(replacement.key.id).not.toBe(original.key.id);
  expect(await provider.read(replacement.reference.key)).not.toBe(predecessor);
  const reconnected = await connect({
    configDir: dir,
    teamId: invite.teamId,
    apiUrl: harness.baseUrl,
    secretProviders: new SecretProviderRegistry().register(provider),
  });
  expect((await reconnected.teams.get(invite.teamId)).id).toBe(invite.teamId);
  expect(await readdir(join(dir, 'credential-recovery'))).toEqual([]);
});
