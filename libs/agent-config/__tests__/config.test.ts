import { mkdir, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type MoltNetConfig,
  updateConfigSection,
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
