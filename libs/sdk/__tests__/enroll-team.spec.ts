import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type MoltNetConfig,
  readConfig,
  writeConfig,
} from '@moltnet/agent-config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../src/agent.js';
import {
  CredentialPersistenceError,
  prepareCredentialPersistence,
} from '../src/credential-persistence.js';
import {
  EnrollmentRecoveryError,
  enrollTeam,
  ProvisioningNotStartedError,
} from '../src/enroll-team.js';
import {
  discardEnrollmentRecovery,
  listEnrollmentRecoveries,
  restoreCapturedEnrollment,
} from '../src/enroll-team-recovery.js';
import { FileSecretProvider } from '../src/file-secret-provider.js';
import { SecretProviderRegistry } from '../src/secrets.js';
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

describe('human enrollment replacement and recovery', () => {
  const provision =
    vi.fn<NonNullable<Parameters<typeof enrollTeam>[0]['provision']>>();

  it('cleans up recovery metadata when approval never reached issuance', async () => {
    const { dir, provider } = await fixture();
    provision.mockRejectedValueOnce(
      new ProvisioningNotStartedError(new Error('Approval already pending')),
    );
    await expect(
      enrollTeam({
        provision,
        provisioningContext: {
          teamId: 'team',
          operation: 'enroll',
          scopes: ['task:execute'],
        },
        idempotencyKey: 'not-started',
        configDir: dir,
        secretProvider: provider,
      }),
    ).rejects.toBeInstanceOf(ProvisioningNotStartedError);
    expect(await readdir(join(dir, 'credential-recovery'))).toEqual([]);
  });

  it('retains protected request context on a lost response without claiming secret capture', async () => {
    const { dir, provider } = await fixture();
    provision.mockRejectedValue(
      new Error('transport failed with sensitive details'),
    );
    const failure = await enrollTeam({
      provision,
      provisioningContext: {
        teamId: 'team',
        operation: 'enroll',
        scopes: ['task:execute'],
      },
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
      retryContext: {
        provisioning: {
          teamId: 'team',
          operation: 'enroll',
          scopes: ['task:execute'],
        },
        idempotencyKey: 'same-request',
      },
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
      provision.mockImplementation(async () => {
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
        return response as Awaited<
          ReturnType<NonNullable<Parameters<typeof enrollTeam>[0]['provision']>>
        >;
      });
      const result = await enrollTeam({
        provision,
        replacement: { teamId: 'team' },
        code: 'invite',
        idempotencyKey: 'renewal',
        configDir: dir,
        secretProvider: provider,
      }).catch((e: unknown) => e);
      expect(provision).toHaveBeenCalled();
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

  it('restores a captured credential locally without returning its secret', async () => {
    const { dir, provider, response } = await fixture();
    const write = vi
      .spyOn(provider, 'write')
      .mockRejectedValueOnce(new Error('temporary provider failure'));
    const failed = await enrollTeam({
      provision: async () => response as never,
      provisioningContext: {
        teamId: 'team',
        operation: 'enroll',
        scopes: ['task:execute'],
      },
      idempotencyKey: 'capture',
      configDir: dir,
      secretProvider: provider,
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(CredentialPersistenceError);
    const recoveryId = (failed as CredentialPersistenceError)
      .recoveryPath!.split('/')
      .at(-1)!;
    const summaries = await listEnrollmentRecoveries(dir);
    expect(summaries).toMatchObject([
      { recoveryId, secretCaptured: true, teamId: 'team', keyId: 'key' },
    ]);
    expect(JSON.stringify(summaries)).not.toContain('issued-secret');

    write.mockRestore();
    const verify = vi.fn().mockResolvedValue({ keyId: 'key' });
    const restored = await restoreCapturedEnrollment({
      configDir: dir,
      recoveryId,
      providers: new SecretProviderRegistry().register(provider),
      verify,
    });
    expect(restored).toEqual({ teamId: 'team', keyId: 'key' });
    expect(verify).toHaveBeenCalledWith('team', 'issued-secret');
    expect(await provider.read('agent-key/subject/team')).toBe('issued-secret');
    expect((await readConfig(dir))?.agent_key_refs?.team).toEqual({
      provider: 'file',
      key: 'agent-key/subject/team',
    });
    expect(await listEnrollmentRecoveries(dir)).toEqual([]);
  });

  it('keeps a captured record when verification fails', async () => {
    const { dir, provider, response } = await fixture();
    vi.spyOn(provider, 'write').mockRejectedValueOnce(new Error('offline'));
    const failed = await enrollTeam({
      provision: async () => response as never,
      provisioningContext: {
        teamId: 'team',
        operation: 'enroll',
        scopes: ['task:execute'],
      },
      idempotencyKey: 'capture',
      configDir: dir,
      secretProvider: provider,
    }).catch((error: unknown) => error);
    const recoveryId = (failed as CredentialPersistenceError)
      .recoveryPath!.split('/')
      .at(-1)!;
    await expect(
      restoreCapturedEnrollment({
        configDir: dir,
        recoveryId,
        providers: new SecretProviderRegistry().register(provider),
        verify: async () => {
          throw new Error('remote verification unavailable');
        },
      }),
    ).rejects.toMatchObject({ code: 'verification_unavailable' });
    expect(await listEnrollmentRecoveries(dir)).toHaveLength(1);
  });

  it('discards only the recovery record whose capture state was confirmed', async () => {
    const { dir } = await fixture();
    const recoveryDir = join(dir, 'credential-recovery');
    await mkdir(recoveryDir, { mode: 0o700 });
    const recoveryId = '11111111-1111-4111-8111-111111111111.json';
    const path = join(recoveryDir, recoveryId);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        configDir: dir,
        secretCaptured: true,
        secret: 'captured-secret',
      }),
      { mode: 0o600 },
    );
    await expect(
      discardEnrollmentRecovery({
        configDir: dir,
        recoveryId,
        expectedSecretCaptured: false,
      }),
    ).rejects.toMatchObject({ code: 'recovery_state_changed' });
    expect(await readFile(path, 'utf8')).toContain('captured-secret');
    await discardEnrollmentRecovery({
      configDir: dir,
      recoveryId,
      expectedSecretCaptured: true,
    });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps an in-progress enrollment record until issuance has stopped', async () => {
    const { dir } = await fixture();
    const recovery = await prepareCredentialPersistence(dir, {
      subjectId: 'subject',
      idempotencyKey: 'pending',
      mode: 'human-pkce',
    });
    const recoveryId = recovery.path.split('/').at(-1)!;
    await expect(
      discardEnrollmentRecovery({
        configDir: dir,
        recoveryId,
        expectedSecretCaptured: false,
      }),
    ).rejects.toMatchObject({ code: 'recovery_in_progress' });
    await recovery.retain();
    await discardEnrollmentRecovery({
      configDir: dir,
      recoveryId,
      expectedSecretCaptured: false,
    });
    expect(await listEnrollmentRecoveries(dir)).toEqual([]);
  });

  it.each([
    'candidate-rejected',
    'key-id-mismatch',
    'subject-mismatch',
    'team-mismatch',
    'reference-mismatch',
    'slot-mismatch',
    'config-dir-mismatch',
    'no-secret',
  ] as const)(
    'leaves a working renewal untouched when recovery is invalid: %s',
    async (scenario) => {
      const { dir, config, provider } = await fixture();
      const reference = { provider: 'file', key: 'agent-key/subject/team' };
      await provider.write(reference.key, 'predecessor');
      await writeConfig(
        { ...config, agent_key_refs: { team: reference } },
        dir,
      );
      const recoveryDir = join(dir, 'credential-recovery');
      await mkdir(recoveryDir, { mode: 0o700 });
      const recoveryId = '11111111-1111-4111-8111-111111111111.json';
      const path = join(recoveryDir, recoveryId);
      const record = {
        version: 1,
        configDir: dir,
        createdAt: new Date().toISOString(),
        secretCaptured: true,
        secret: 'candidate',
        subjectId: 'subject',
        teamId: 'team',
        keyId: 'key',
        reference,
        retryContext: {
          subjectId: 'subject',
          idempotencyKey: 'request',
          mode: 'human-pkce',
          provisioning: {
            teamId: 'team',
            operation: 'renew',
            scopes: ['task:execute'],
          },
          observedReference: reference,
          observedCredentialHash: createHash('sha256')
            .update('predecessor')
            .digest('hex'),
        },
      };
      if (scenario === 'subject-mismatch') record.subjectId = 'other';
      if (scenario === 'team-mismatch')
        record.retryContext.provisioning.teamId = 'other';
      if (scenario === 'reference-mismatch')
        record.reference = { ...reference, key: 'other' };
      if (scenario === 'slot-mismatch')
        record.retryContext.observedReference = { ...reference, key: 'other' };
      if (scenario === 'config-dir-mismatch')
        record.configDir = join(dir, 'other');
      if (scenario === 'no-secret') record.secretCaptured = false;
      await writeFile(path, JSON.stringify(record), { mode: 0o600 });
      const verify = vi.fn(async () => {
        if (scenario === 'candidate-rejected')
          throw new Error('invalid candidate');
        return { keyId: scenario === 'key-id-mismatch' ? 'other' : 'key' };
      });
      await expect(
        restoreCapturedEnrollment({
          configDir: dir,
          recoveryId,
          providers: new SecretProviderRegistry().register(provider),
          verify,
        }),
      ).rejects.toThrow();
      expect(await provider.read(reference.key)).toBe('predecessor');
      expect((await readConfig(dir))?.agent_key_refs?.team).toEqual(reference);
      expect(await readFile(path, 'utf8')).toContain('candidate');
    },
  );

  it('rejects traversal IDs and skips an incomplete record during listing', async () => {
    const { dir, provider } = await fixture();
    const recoveryDir = join(dir, 'credential-recovery');
    await mkdir(recoveryDir);
    await writeFile(
      join(recoveryDir, '11111111-1111-4111-8111-111111111111.json'),
      '',
    );
    expect(await listEnrollmentRecoveries(dir)).toEqual([]);
    await expect(
      restoreCapturedEnrollment({
        configDir: dir,
        recoveryId: '../moltnet.json',
        providers: new SecretProviderRegistry().register(provider),
        verify: async () => ({ keyId: 'key' }),
      }),
    ).rejects.toMatchObject({ code: 'record_invalid' });
  });
});
