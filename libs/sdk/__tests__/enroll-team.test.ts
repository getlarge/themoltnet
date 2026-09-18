import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type MoltNetConfig, writeConfig } from '@moltnet/agent-config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../src/agent.js';
import { CredentialPersistenceError } from '../src/credential-persistence.js';
import { EnrollmentRecoveryError,enrollTeam } from '../src/enroll-team.js';
import { requestProofEnrollment } from '../src/enrollment-proof.js';

vi.mock('../src/enrollment-proof.js', () => ({
  requestProofEnrollment: vi.fn(),
  EnrollmentRequestError: class extends Error {},
}));
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

describe('proof enrollment replacement and recovery', () => {
  const signer = { sign: async () => 'proof' };

  it('retains protected request context on a lost response without claiming secret capture', async () => {
    const { dir, provider } = await fixture();
    vi.mocked(requestProofEnrollment).mockRejectedValue(
      new Error('transport failed with sensitive details'),
    );
    const failure = await enrollTeam({
      signer,
      code: 'invitation',
      idempotencyKey: 'same-request',
      configDir: dir,
      secretProvider: provider,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(EnrollmentRecoveryError);
    const error = failure as EnrollmentRecoveryError;
    expect(error.secretCaptured).toBe(false);
    const record = JSON.parse(await readFile(error.recoveryPath, 'utf8'));
    expect(record).toMatchObject({
      secretCaptured: false,
      retryContext: { code: 'invitation', idempotencyKey: 'same-request' },
    });
    expect(record).not.toHaveProperty('secret');
    expect((await stat(error.recoveryPath)).mode & 0o777).toBe(0o600);
    expect(String(error)).not.toContain('sensitive');
    expect(JSON.stringify(error)).not.toContain('invitation');
  });

  it.each([
    'unchanged',
    'secret-race',
    'slot-race',
    'readback-failure',
  ] as const)(
    'replaces only the observed slot and secret: %s',
    async (scenario) => {
      const { dir, config, provider, response, path } = await fixture();
      const reference = { provider: 'file', key: 'agent-key/subject/team' };
      await provider.write(reference.key, 'predecessor');
      await writeConfig(
        { ...config, agent_key_refs: { team: reference } },
        dir,
      );
      vi.mocked(requestProofEnrollment).mockImplementation(async () => {
        if (scenario === 'secret-race')
          await provider.write(reference.key, 'concurrent-writer');
        if (scenario === 'slot-race')
          await writeConfig(
            {
              ...config,
              agent_key_refs: {
                team: { ...reference, provider: 'os-keyring' },
              },
            },
            dir,
          );
        if (scenario === 'readback-failure')
          vi.spyOn(provider, 'write').mockResolvedValue(undefined);
        return response as Awaited<ReturnType<typeof requestProofEnrollment>>;
      });
      const result = await enrollTeam({
        signer,
        replacement: { teamId: 'team' },
        code: 'invite',
        idempotencyKey: 'renewal',
        configDir: dir,
        secretProvider: provider,
      }).catch((e: unknown) => e);
      expect(requestProofEnrollment).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedTeamId: 'team' }),
      );
      if (scenario === 'unchanged') {
        expect(result).toMatchObject({ teamId: 'team', key: { id: 'key' } });
        expect(await provider.read(reference.key)).toBe('issued-secret');
        expect(await readdir(join(dir, 'credential-recovery'))).toEqual([]);
      } else {
        expect(result).toBeInstanceOf(CredentialPersistenceError);
        const error = result as CredentialPersistenceError;
        expect(error.secretCaptured).toBe(true);
        expect(
          JSON.parse(await readFile(error.recoveryPath!, 'utf8')).secret,
        ).toBe('issued-secret');
        expect(await provider.read(reference.key)).toBe(
          scenario === 'secret-race' ? 'concurrent-writer' : 'predecessor',
        );
      }
      expect(JSON.parse(await readFile(path, 'utf8')).agent_key_ref).toEqual(
        config.agent_key_ref,
      );
    },
  );
});
