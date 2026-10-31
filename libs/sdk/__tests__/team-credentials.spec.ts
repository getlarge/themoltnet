import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CredentialPersistenceError,
  prepareCredentialPersistence,
} from '../src/credential-persistence.js';
import { resolveAgentKey } from '../src/credential-resolver.js';
import { FileSecretProvider } from '../src/file-secret-provider.js';
import {
  READ_WRITE_CAPABILITIES,
  SecretProviderRegistry,
} from '../src/secrets.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('team credential resolution', () => {
  const reference = (team?: string) => ({
    provider: 'memory',
    key: `agent-key/subject${team ? '/' + team : ''}`,
  });
  it('selects one grant and treats provider failure as terminal', async () => {
    const reads: string[] = [];
    const provider = {
      name: 'memory',
      capabilities: READ_WRITE_CAPABILITIES,
      read: async (key: string) => {
        reads.push(key);
        if (key.endsWith('/a')) throw new Error('unavailable');
        return 'fallback-secret';
      },
      probe: async () => 'present' as const,
    };
    const registry = new SecretProviderRegistry().register(provider);
    const config = {
      subject_id: 'subject',
      agent_key_ref: reference(),
      agent_key_refs: { a: reference('a'), b: reference('b') },
    };
    await expect(resolveAgentKey(config, registry, 'a')).rejects.toMatchObject({
      code: 'provider_failure',
    });
    expect(reads).toEqual(['agent-key/subject/a']);
    await expect(resolveAgentKey(config, registry, 'missing')).resolves.toBe(
      'fallback-secret',
    );
    expect(reads).toEqual(['agent-key/subject/a', 'agent-key/subject']);
  });
  it('does not fall back from an unknown provider or unbound selected reference', async () => {
    const registry = new SecretProviderRegistry();
    await expect(
      resolveAgentKey(
        {
          subject_id: 'subject',
          agent_key_refs: {
            a: { provider: 'unknown', key: 'agent-key/subject/a' },
          },
        },
        registry,
        'a',
      ),
    ).rejects.toMatchObject({ code: 'provider_failure' });
    await expect(
      resolveAgentKey(
        {
          subject_id: 'subject',
          agent_key_refs: {
            a: { provider: 'unknown', key: 'agent-key/other/a' },
          },
        },
        registry,
        'a',
      ),
    ).rejects.toMatchObject({ code: 'unbound' });
  });
});

describe('credential persistence recovery', () => {
  it('retains protected recovery after a config commit fails, preserving the stored secret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdk-recovery-'));
    directories.push(dir);
    const provider = new FileSecretProvider({ root: dir, writable: true });
    const reference = { provider: 'file', key: 'agent-key/subject/team' };
    const recovery = await prepareCredentialPersistence(dir);
    const failure = await recovery
      .persist(
        provider,
        reference,
        'issued-secret',
        { subjectId: 'subject', teamId: 'team', keyId: 'key' },
        async (store) => {
          await store();
          throw new Error('injected config failure with issued-secret');
        },
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialPersistenceError);
    expect(JSON.stringify(failure)).not.toContain('issued-secret');
    expect((await stat(recovery.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(recovery.path, 'utf8'))).toMatchObject({
      reference,
      secret: 'issued-secret',
      subjectId: 'subject',
      teamId: 'team',
      keyId: 'key',
    });
    expect(await provider.read(reference.key)).toBe('issued-secret');
  });
  it('never replaces a conflicting provider value and removes recovery only after commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdk-recovery-'));
    directories.push(dir);
    const provider = new FileSecretProvider({ root: dir, writable: true });
    const reference = { provider: 'file', key: 'agent-key/subject/team' };
    await provider.write(reference.key, 'previous-secret');
    const recovery = await prepareCredentialPersistence(dir);
    await expect(
      recovery.persist(
        provider,
        reference,
        'new-secret',
        { subjectId: 'subject' },
        (store) => store(),
      ),
    ).rejects.toBeInstanceOf(CredentialPersistenceError);
    expect(await provider.read(reference.key)).toBe('previous-secret');
    const successful = await prepareCredentialPersistence(dir);
    await successful.persist(
      provider,
      reference,
      'previous-secret',
      { subjectId: 'subject' },
      (store) => store(),
    );
    expect(await readdir(join(dir, 'credential-recovery'))).toHaveLength(1);
  });
});
