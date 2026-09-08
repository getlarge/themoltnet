import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type GitHubConfig,
  type KeysConfig,
  type LegacyMoltNetConfig,
  type MoltNetConfig,
  updateConfigSection,
  updateGitHubConfig,
  updateKeysConfig,
  updateOAuth2Config,
  writeConfig,
} from '../src/config.js';

function config(): MoltNetConfig {
  return {
    subject_id: 'subject-1',
    subject_type: 'agent',
    registered_at: '2026-01-01T00:00:00Z',
    oauth2: { client_id: 'client', client_secret: 'plaintext' },
    keys: { public_key: 'pub', private_key: 'priv', fingerprint: 'fp' },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
  };
}

describe('OAuth2 config updates', () => {
  it('round-trips a canonical subject anchor without identity_id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    const path = await writeConfig(config(), dir);
    const stored = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(stored).toMatchObject({
      subject_id: 'subject-1',
      subject_type: 'agent',
    });
    expect(stored).not.toHaveProperty('identity_id');
  });

  it('round-trips an agent-key-only config without an OAuth2 section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    const { oauth2: _oauth2, ...agentKeyOnly } = config();

    const path = await writeConfig(
      {
        ...agentKeyOnly,
        agent_key_ref: {
          provider: 'file',
          key: 'agent-key/subject-1',
        },
      },
      dir,
    );

    const stored = JSON.parse(await readFile(path, 'utf8')) as MoltNetConfig;
    expect(stored.oauth2).toBeUndefined();
    expect(stored.agent_key_ref).toEqual({
      provider: 'file',
      key: 'agent-key/subject-1',
    });
  });

  it('replaces plaintext with a reference without retaining both forms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-config-'));
    await writeConfig(config(), dir);

    await updateOAuth2Config(
      {
        client_id: 'client',
        client_secret_ref: {
          provider: 'os-keyring',
          key: 'oauth2/identity/client',
        },
      },
      dir,
    );

    const stored = JSON.parse(
      await readFile(join(dir, 'moltnet.json'), 'utf8'),
    ) as MoltNetConfig;
    expect(stored.oauth2).toEqual({
      client_id: 'client',
      client_secret_ref: {
        provider: 'os-keyring',
        key: 'oauth2/identity/client',
      },
    });
    expect(stored.oauth2).not.toHaveProperty('client_secret');
  });

  it('rejects shallow OAuth2 updates through the generic helper', async () => {
    await expect(
      updateConfigSection('oauth2', {
        client_secret_ref: { provider: 'os-keyring', key: 'key' },
      }),
    ).rejects.toThrow(/updateOAuth2Config/);
  });

  it('writes config atomically with private permissions and no leftover temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));

    const path = await writeConfig(config(), dir);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['moltnet.json']);
  });

  it('leaves an existing config untouched when the write cannot be committed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);
    const before = await readFile(join(dir, 'moltnet.json'), 'utf8');
    // A directory at the target path makes the final rename fail.
    await mkdir(join(dir, 'blocker'));
    const blocked = join(dir, 'blocker');
    await mkdir(join(blocked, 'moltnet.json'));

    await expect(
      writeConfig({ ...config(), subject_id: 'other' }, blocked),
    ).rejects.toThrow();
    expect(await readFile(join(dir, 'moltnet.json'), 'utf8')).toBe(before);
    expect(await readdir(blocked)).toEqual(['moltnet.json']);
  });

  it('keeps the legacy read shape out of canonical writers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    const {
      subject_id: _subjectId,
      subject_type: _subjectType,
      ...rest
    } = config();
    const legacy: LegacyMoltNetConfig = {
      ...rest,
      identity_id: 'legacy-identity',
    };

    await expect(
      writeConfig(legacy as unknown as MoltNetConfig, dir),
    ).rejects.toThrow(/moltnet config migrate/);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ['section', (dir: string) => updateConfigSection('git', {}, dir)],
    [
      'oauth2',
      (dir: string) =>
        updateOAuth2Config(
          { client_id: 'client', client_secret: 'secret' },
          dir,
        ),
    ],
    [
      'keys',
      (dir: string) =>
        updateKeysConfig(
          { public_key: 'pub', private_key: 'seed', fingerprint: 'fp' },
          dir,
        ),
    ],
    [
      'github',
      (dir: string) =>
        updateGitHubConfig(
          { app_id: '1', installation_id: '2', private_key_path: '/pem' },
          dir,
        ),
    ],
  ])('keeps legacy configs out of the %s updater', async (_name, update) => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    const { subject_id: _id, subject_type: _type, ...rest } = config();
    await writeFile(
      join(dir, 'moltnet.json'),
      JSON.stringify({ ...rest, identity_id: 'legacy-identity' }),
    );

    await expect(update(dir)).rejects.toThrow(/moltnet config migrate/);
  });
});

describe('keys config updates', () => {
  it('replaces the plaintext seed with a reference without retaining both forms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);

    await updateKeysConfig(
      {
        public_key: 'pub',
        fingerprint: 'fp',
        private_key_ref: { provider: 'os-keyring', key: 'identity/fp/seed' },
      },
      dir,
    );

    const raw = await readFile(join(dir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('"private_key"');
    expect(raw).toContain('"private_key_ref"');
    expect(JSON.parse(raw).keys).toEqual({
      public_key: 'pub',
      fingerprint: 'fp',
      private_key_ref: { provider: 'os-keyring', key: 'identity/fp/seed' },
    });
  });

  it('rejects keys that set both or neither secret form', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);
    const both = {
      public_key: 'pub',
      fingerprint: 'fp',
      private_key: 'priv',
      private_key_ref: { provider: 'os-keyring', key: 'k' },
    } as unknown as KeysConfig;
    const neither = {
      public_key: 'pub',
      fingerprint: 'fp',
    } as unknown as KeysConfig;

    await expect(updateKeysConfig(both, dir)).rejects.toThrow(
      /exactly one of private_key or private_key_ref/,
    );
    await expect(updateKeysConfig(neither, dir)).rejects.toThrow(
      /exactly one of private_key or private_key_ref/,
    );
  });

  it('rejects partial keys updates through the generic helper but accepts a complete replacement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);

    await expect(
      updateConfigSection(
        'keys',
        { private_key_ref: { provider: 'env', key: 'MOLTNET_PRIVATE_KEY' } },
        dir,
      ),
    ).rejects.toThrow(/updateKeysConfig/);

    await updateConfigSection(
      'keys',
      {
        public_key: 'pub',
        fingerprint: 'fp',
        private_key_ref: { provider: 'env', key: 'MOLTNET_PRIVATE_KEY' },
      },
      dir,
    );
    const raw = await readFile(join(dir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('"private_key"');
    expect(JSON.parse(raw).keys.private_key_ref).toEqual({
      provider: 'env',
      key: 'MOLTNET_PRIVATE_KEY',
    });
  });
});

describe('github config updates', () => {
  const base = { app_id: '123', installation_id: '456' };

  it('replaces the PEM path with a reference without retaining both forms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(
      { ...config(), github: { ...base, private_key_path: '/tmp/app.pem' } },
      dir,
    );

    await updateGitHubConfig(
      {
        ...base,
        private_key_ref: {
          provider: 'os-keyring',
          key: 'github-app/123/private-key',
        },
      },
      dir,
    );

    const raw = await readFile(join(dir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('private_key_path');
    expect(JSON.parse(raw).github).toEqual({
      ...base,
      private_key_ref: {
        provider: 'os-keyring',
        key: 'github-app/123/private-key',
      },
    });
  });

  it('rejects github settings that set both or neither PEM form', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);
    const both = {
      ...base,
      private_key_path: '/tmp/app.pem',
      private_key_ref: { provider: 'os-keyring', key: 'k' },
    } as unknown as GitHubConfig;
    const neither = { ...base } as unknown as GitHubConfig;

    await expect(updateGitHubConfig(both, dir)).rejects.toThrow(
      /exactly one of private_key_path or private_key_ref/,
    );
    await expect(updateGitHubConfig(neither, dir)).rejects.toThrow(
      /exactly one of private_key_path or private_key_ref/,
    );
  });

  it('rejects partial github updates through the generic helper but accepts a complete replacement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    await writeConfig(config(), dir);

    await expect(
      updateConfigSection('github', { app_id: '1' }, dir),
    ).rejects.toThrow(/updateGitHubConfig/);

    await updateConfigSection(
      'github',
      {
        ...base,
        private_key_ref: {
          provider: 'env',
          key: 'MOLTNET_GITHUB_APP_PRIVATE_KEY',
        },
      },
      dir,
    );
    const raw = await readFile(join(dir, 'moltnet.json'), 'utf8');
    expect(raw).not.toContain('private_key_path');
    expect(JSON.parse(raw).github.private_key_ref).toEqual({
      provider: 'env',
      key: 'MOLTNET_GITHUB_APP_PRIVATE_KEY',
    });
  });

  it('accepts the setupGitHubAgent app_slug persistence shape (spread of an existing path-form section)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-config-'));
    const github = { ...base, private_key_path: '/tmp/app.pem' };
    await writeConfig({ ...config(), github }, dir);

    await updateConfigSection('github', { ...github, app_slug: 'my-app' }, dir);

    expect(
      JSON.parse(await readFile(join(dir, 'moltnet.json'), 'utf8')).github,
    ).toEqual({
      ...github,
      app_slug: 'my-app',
    });
  });
});
