import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type MoltNetConfig, writeConfig } from '@moltnet/agent-config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../src/agent.js';
import { CredentialPersistenceError } from '../src/credential-persistence.js';
import { enrollTeam } from '../src/enroll-team.js';
import { FileSecretProvider } from '../src/file-secret-provider.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-enroll-'));
  directories.push(dir);
  const config: MoltNetConfig = {
    subject_id: 'subject',
    subject_type: 'agent',
    registered_at: '2026-09-18',
    agent_key_ref: { provider: 'file', key: 'agent-key/subject' },
    keys: {
      public_key: 'public',
      fingerprint: 'fp',
      private_key_ref: { provider: 'file', key: 'identity/fp/seed' },
    },
    endpoints: { api: 'https://api.example', mcp: 'https://api.example/mcp' },
  };
  await writeConfig(config, dir);
  await mkdir(join(dir, 'secrets'), { mode: 0o700 });
  const provider = new FileSecretProvider({
    root: join(dir, 'secrets'),
    writable: true,
  });
  const write = vi.spyOn(provider, 'write');
  const response = {
    teamId: 'team',
    role: 'member',
    agentKey: {
      secret: 'issued-secret',
      key: {
        id: 'key',
        agentId: 'subject',
        bindingScope: 'team',
        teamId: 'team',
      },
    },
  };
  return {
    dir,
    config,
    provider,
    write,
    response,
    path: join(dir, 'moltnet.json'),
  };
}

describe('enrollment response validation', () => {
  it.each([
    'missing-credential',
    'missing-key',
    'missing-key-id',
    'wrong-subject',
    'wrong-team',
    'identity-scope',
    'empty-secret',
    'replaced-identity',
  ])(
    'does not store a credential or overwrite config for %s',
    async (scenario) => {
      const { dir, config, provider, write, response, path } = await fixture();
      let expected = await readFile(path, 'utf8');
      if (scenario === 'missing-key-id') response.agentKey.key.id = '';
      if (scenario === 'wrong-subject') response.agentKey.key.agentId = 'other';
      if (scenario === 'wrong-team') response.agentKey.key.teamId = 'other';
      if (scenario === 'identity-scope')
        response.agentKey.key.bindingScope = 'identity';
      if (scenario === 'empty-secret') response.agentKey.secret = '';
      const joinTeam = async () => {
        if (scenario === 'replaced-identity') {
          await writeConfig({ ...config, subject_id: 'other' }, dir);
          expected = await readFile(path, 'utf8');
        }
        if (scenario === 'missing-credential')
          return { ...response, agentKey: undefined };
        if (scenario === 'missing-key')
          return { ...response, agentKey: { secret: 'issued-secret' } };
        return response;
      };
      const failure = await enrollTeam({
        agent: { teams: { join: joinTeam } } as unknown as Pick<Agent, 'teams'>,
        code: 'invite',
        idempotencyKey: 'request',
        configDir: dir,
        secretProvider: provider,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (scenario !== 'missing-credential')
        expect(failure).toBeInstanceOf(CredentialPersistenceError);
      expect(write).not.toHaveBeenCalled();
      expect(await readFile(path, 'utf8')).toBe(expected);
      expect(await provider.read('agent-key/subject/team')).toBeNull();
      expect(String(failure)).not.toContain('issued-secret');
      expect(JSON.stringify(failure)).not.toContain('issued-secret');
    },
  );
});
