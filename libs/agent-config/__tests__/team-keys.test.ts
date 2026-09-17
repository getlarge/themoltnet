import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentKeyConfiguration,
  agentKeyKey,
  assertAgentKeyReferenceBinding,
  type MoltNetConfig,
  readConfig,
  selectAgentKeyReference,
  updateConfig,
  updateTeamAgentKeyReference,
  withConfigLock,
  writeConfig,
} from '../src/index.js';

const cases = JSON.parse(
  await readFile(
    new URL('./fixtures/team-key-selection.json', import.meta.url),
    'utf8',
  ),
) as Array<{
  name: string;
  config: AgentKeyConfiguration;
  selectedTeam?: string;
  reference: { provider: string; key: string } | null;
  teamId?: string;
  error?: boolean;
}>;

const directories: string[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'team-config-'));
  directories.push(dir);
  const config: MoltNetConfig = {
    subject_id: 'subject',
    subject_type: 'agent',
    registered_at: '2026-09-17',
    endpoints: { api: 'https://api.example', mcp: 'https://mcp.example' },
    keys: {
      public_key: 'public',
      fingerprint: 'fp',
      private_key_ref: { provider: 'file', key: 'identity/fp/seed' },
    },
    agent_key_refs: {},
  };
  await writeConfig(config, dir);
  return { dir, path: join(dir, 'moltnet.json') };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('shared credential selection fixtures', () => {
  it.each(cases)(
    '$name',
    ({ config, selectedTeam, reference, teamId, error }) => {
      if (error) {
        expect(() => selectAgentKeyReference(config, selectedTeam)).toThrow();
        return;
      }
      expect(selectAgentKeyReference(config, selectedTeam)).toEqual(
        reference ? { reference, ...(teamId ? { teamId } : {}) } : null,
      );
    },
  );
  it('fails invalid selected bindings without selecting the fallback', () => {
    for (const reference of [
      { provider: 'env', key: 'MOLTNET_AGENT_KEY' },
      { provider: 'os-keyring', key: agentKeyKey('other', 'a') },
      { provider: 'file', key: agentKeyKey('subject', 'b') },
      { provider: 'BAD', key: agentKeyKey('subject', 'a') },
    ]) {
      const selected = selectAgentKeyReference(
        {
          agent_key_ref: { provider: 'file', key: agentKeyKey('subject') },
          agent_key_refs: { a: reference },
        },
        'a',
      );
      expect(selected?.reference).toEqual(reference);
      expect(() =>
        assertAgentKeyReferenceBinding(selected!, 'subject'),
      ).toThrow();
    }
  });
  it('accepts flattened file references but keeps team and subject binding', () => {
    expect(() =>
      assertAgentKeyReferenceBinding(
        {
          reference: { provider: 'file', key: 'agent-key.subject.a' },
          teamId: 'a',
        },
        'subject',
      ),
    ).not.toThrow();
  });
});

describe('shared config updates', () => {
  it('pins the selected identity throughout an asynchronous update', async () => {
    const { dir } = await fixture();
    const config = (await readConfig(dir)) as MoltNetConfig;
    vi.stubEnv('HOME', dir);
    vi.stubEnv('MOLTNET_ACTIVE_IDENTITY', 'first');
    const first = join(dir, '.config/moltnet/identities/first');
    const second = join(dir, '.config/moltnet/identities/second');
    await writeConfig(config, first);
    await writeConfig({ ...config, subject_id: 'second' }, second);
    await updateConfig(async (selected) => {
      await Promise.resolve();
      vi.stubEnv('MOLTNET_ACTIVE_IDENTITY', 'second');
      selected.registered_at = 'updated';
    });
    expect(await readConfig(first)).toMatchObject({
      subject_id: 'subject',
      registered_at: 'updated',
    });
    expect(await readConfig(second)).toMatchObject({
      subject_id: 'second',
      registered_at: '2026-09-17',
    });
  });
  it('preserves all concurrent entries and unrelated fields', async () => {
    const { dir, path } = await fixture();
    const original = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      path,
      JSON.stringify({ ...original, future: { nested: ['kept'] } }),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        updateTeamAgentKeyReference(
          'subject',
          String(i),
          { provider: 'file', key: agentKeyKey('subject', String(i)) },
          dir,
        ),
      ),
    );
    const result = JSON.parse(await readFile(path, 'utf8')) as {
      agent_key_refs: object;
      future: unknown;
    };
    expect(Object.keys(result.agent_key_refs)).toHaveLength(12);
    expect(result.future).toEqual({ nested: ['kept'] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readConfig(dir)).toMatchObject({ subject_id: 'subject' });
  });
  it('leaves the previous file usable when mutation fails or subject changes', async () => {
    const { dir, path } = await fixture();
    const before = await readFile(path, 'utf8');
    await expect(
      updateConfig((config) => {
        config.subject_id = 'changed';
        throw new Error('injected');
      }, dir),
    ).rejects.toThrow('injected');
    await expect(
      updateTeamAgentKeyReference(
        'other',
        'a',
        { provider: 'file', key: agentKeyKey('other', 'a') },
        dir,
      ),
    ).rejects.toThrow('anchor');
    expect(await readFile(path, 'utf8')).toBe(before);
    await updateTeamAgentKeyReference(
      'subject',
      'a',
      { provider: 'file', key: agentKeyKey('subject', 'a') },
      dir,
    );
  });
  it('never steals an existing writer lock and releases after failure', async () => {
    const { path } = await fixture();
    await expect(
      withConfigLock(path, async () => {
        await expect(
          withConfigLock(path, async () => undefined, 30),
        ).rejects.toThrow('confirm no writer');
        throw new Error('failed writer');
      }),
    ).rejects.toThrow('failed writer');
    await expect(withConfigLock(path, async () => 'released')).resolves.toBe(
      'released',
    );
  });
});
