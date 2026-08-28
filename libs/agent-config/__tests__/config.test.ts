import { mkdir, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type KeysConfig,
  type MoltNetConfig,
  updateConfigSection,
  updateKeysConfig,
  updateOAuth2Config,
  writeConfig,
} from '../src/config.js';

function config(): MoltNetConfig {
  return {
    identity_id: 'identity',
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
      writeConfig({ ...config(), identity_id: 'other' }, blocked),
    ).rejects.toThrow();
    expect(await readFile(join(dir, 'moltnet.json'), 'utf8')).toBe(before);
    expect(await readdir(blocked)).toEqual(['moltnet.json']);
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
