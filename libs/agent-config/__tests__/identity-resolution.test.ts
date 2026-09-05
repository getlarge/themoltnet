import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertIdentityAlias,
  getConfigDir,
  getConfigPath,
  getIdentityDir,
  getLegacyConfigPath,
  type MoltNetConfig,
  readConfig,
  resolveConfigDir,
} from '../src/config.js';

const savedEnv = { ...process.env };

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'moltnet-identity-'));
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  await mkdir(getConfigDir(), { recursive: true });
  return home;
}

function credentials(id: string): MoltNetConfig {
  return {
    identity_id: id,
    oauth2: { client_id: 'c', client_secret: 's', token_url: 'https://t' },
    keys: { public_key: 'pub', private_key: 'priv' },
    endpoints: { api: 'https://api', mcp: 'https://api/mcp' },
  } as unknown as MoltNetConfig;
}

async function writeIdentity(alias: string, id: string): Promise<void> {
  const dir = getIdentityDir(alias);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'moltnet.json'), JSON.stringify(credentials(id)));
}

beforeEach(() => {
  delete process.env.MOLTNET_ACTIVE_IDENTITY;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

// The alias turns an untrusted string into a filesystem path for credential
// storage, so its grammar is a security boundary, not a naming preference.
describe('assertIdentityAlias', () => {
  it('accepts exactly what the Go CLI and the daemon store accept', () => {
    for (const valid of ['agent', 'agent.v2', 'A_1-b', 'a', 'a'.repeat(63)]) {
      expect(() => assertIdentityAlias(valid)).not.toThrow();
    }
  });

  it('rejects traversal, empty, and over-long aliases', () => {
    for (const invalid of [
      '',
      '.',
      '..',
      '../escape',
      '/absolute',
      'has/slash',
      '.leading-dot',
      '-leading-dash',
      'has space',
      'a'.repeat(64),
    ]) {
      expect(() => assertIdentityAlias(invalid)).toThrow(
        /invalid identity alias/,
      );
    }
  });

  it('refuses to build a path from a traversing alias', () => {
    expect(() => getIdentityDir('../../etc')).toThrow(/invalid identity alias/);
  });
});

describe('identity resolution ladder', () => {
  it('prefers an explicit dir, then the env var, then the selector', async () => {
    await freshHome();
    await writeIdentity('from-env', 'env');
    await writeIdentity('from-selector', 'selector');
    await writeFile(
      join(getConfigDir(), 'identity-selector.json'),
      JSON.stringify({ version: 1, default_identity: 'from-selector' }),
    );

    // Selector alone.
    expect(await resolveConfigDir()).toBe(getIdentityDir('from-selector'));
    expect((await readConfig())?.identity_id).toBe('selector');

    // The env var must OVERRIDE the persisted selector, not merely be used
    // when the selector is absent.
    process.env.MOLTNET_ACTIVE_IDENTITY = 'from-env';
    expect(await resolveConfigDir()).toBe(getIdentityDir('from-env'));
    expect((await readConfig())?.identity_id).toBe('env');
    expect(getConfigPath()).toBe(
      join(getIdentityDir('from-env'), 'moltnet.json'),
    );

    // An explicit directory outranks both.
    expect(await resolveConfigDir('/explicit')).toBe('/explicit');
    expect(getConfigPath('/explicit')).toBe(join('/explicit', 'moltnet.json'));
  });

  it('answers the same question the same way in sync and async form', async () => {
    await freshHome();
    await writeIdentity('picked', 'picked');
    await writeFile(
      join(getConfigDir(), 'identity-selector.json'),
      JSON.stringify({ version: 1, default_identity: 'picked' }),
    );

    // getConfigPath is sync and was previously env-only, so with only a
    // selector set it threw while readConfig succeeded.
    expect(getConfigPath()).toBe(
      join(getIdentityDir('picked'), 'moltnet.json'),
    );
    expect(await resolveConfigDir()).toBe(getIdentityDir('picked'));
  });

  it('never throws from getConfigPath when nothing is selected', async () => {
    await freshHome();
    // It is re-exported from @themoltnet/sdk with an unchanged signature and
    // is used inside error messages; throwing breaks callers at runtime with
    // nothing for TypeScript to flag.
    expect(() => getConfigPath()).not.toThrow();
    expect(getConfigPath()).toBe(getLegacyConfigPath());
  });

  it('rejects an unsupported selector version instead of guessing', async () => {
    await freshHome();
    await writeFile(
      join(getConfigDir(), 'identity-selector.json'),
      JSON.stringify({ version: 99, default_identity: 'whatever' }),
    );
    await expect(resolveConfigDir()).rejects.toThrow(/not supported/);
  });

  it('falls back to the pre-central-store document on upgrade', async () => {
    await freshHome();
    // An install that predates the central store: credentials sit at
    // <config>/moltnet.json with no identities dir and no selector. Reporting
    // "no config found - run moltnet register" would be wrong and destructive.
    await writeFile(
      getLegacyConfigPath(),
      JSON.stringify(credentials('legacy')),
    );

    expect(await resolveConfigDir()).toBeNull();
    expect((await readConfig())?.identity_id).toBe('legacy');
  });

  it('does not fall back when an explicit dir was requested', async () => {
    const home = await freshHome();
    await writeFile(
      getLegacyConfigPath(),
      JSON.stringify(credentials('legacy')),
    );
    expect(await readConfig(join(home, 'nowhere'))).toBeNull();
  });
});
