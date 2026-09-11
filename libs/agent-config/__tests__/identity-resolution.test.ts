import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import type * as NodeOS from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getConfigDir() resolves through os.homedir(), which does NOT follow a
// reassigned process.env.HOME. Isolating via the env var therefore let these
// tests write into the developer's real ~/.config/moltnet — including
// overwriting identity-selector.json. Mock homedir instead, and assert the
// isolation actually held before any test writes anything.
const homeRef = vi.hoisted(() => ({ value: '' }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOS>();
  return {
    ...actual,
    default: { ...actual, homedir: () => homeRef.value || actual.homedir() },
    homedir: () => homeRef.value || actual.homedir(),
  };
});

import {
  assertIdentityAlias,
  getConfigDir,
  getConfigPath,
  getIdentityDir,
  type MoltNetConfig,
  readConfig,
  resolveConfigDir,
  resolveConfigPath,
  writeConfig,
} from '../src/config.js';

const savedEnv = { ...process.env };

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'moltnet-identity-'));
  homeRef.value = home;
  // Fail loudly rather than write to a real config directory.
  const dir = getConfigDir();
  if (!dir.startsWith(home)) {
    throw new Error(`test isolation failed: getConfigDir() = ${dir}`);
  }
  await mkdir(dir, { recursive: true });
  return home;
}

function credentials(id: string): MoltNetConfig {
  return {
    subject_id: id,
    subject_type: 'agent',
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
});

afterEach(() => {
  process.env = { ...savedEnv };
  homeRef.value = '';
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
    expect((await readConfig())?.subject_id).toBe('selector');

    // The env var must OVERRIDE the persisted selector, not merely be used
    // when the selector is absent.
    process.env.MOLTNET_ACTIVE_IDENTITY = 'from-env';
    expect(await resolveConfigDir()).toBe(getIdentityDir('from-env'));
    expect((await readConfig())?.subject_id).toBe('env');
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

  it('never throws from getConfigPath, and keeps returning a file path', async () => {
    const home = await freshHome();
    // Re-exported from @themoltnet/sdk with an unchanged `string` signature, so
    // throwing would break callers at runtime with nothing for TypeScript to
    // flag — and returning a DIRECTORY would surface as EISDIR for anyone who
    // hands it to readFile. It stays a file path that simply does not exist.
    expect(() => getConfigPath()).not.toThrow();
    const p = getConfigPath();
    expect(p.endsWith('moltnet.json')).toBe(true);
    expect(p.startsWith(join(home, '.config', 'moltnet'))).toBe(true);

    // resolveConfigPath is the honest form: it can say "none".
    expect(await resolveConfigPath()).toBeNull();
  });

  it('rejects an unsupported selector version instead of guessing', async () => {
    await freshHome();
    await writeFile(
      join(getConfigDir(), 'identity-selector.json'),
      JSON.stringify({ version: 99, default_identity: 'whatever' }),
    );
    await expect(resolveConfigDir()).rejects.toThrow(/not supported/);
  });

  // The Go CLI never reads <config>/moltnet.json, so a fallback here gave one
  // contract two behaviours: the CLI reporting no identity while the SDK and
  // daemon silently used the retired document. Operators relocate it with
  // `moltnet config migrate`.
  it('does not auto-discover the pre-central-store document', async () => {
    const home = await freshHome();
    await writeFile(
      join(getConfigDir(), 'moltnet.json'),
      JSON.stringify(credentials('legacy')),
    );

    expect(await resolveConfigDir()).toBeNull();
    expect(await readConfig()).toBeNull();
    expect(home).toBeTruthy();
  });

  it('returns null for an explicit dir with no document', async () => {
    const home = await freshHome();
    expect(await readConfig(join(home, 'nowhere'))).toBeNull();
  });

  it('does not treat malformed selected credentials as missing', async () => {
    const home = await freshHome();
    const configDir = join(home, 'malformed');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'moltnet.json'), '{not-json');

    await expect(readConfig(configDir)).rejects.toThrow(
      `Unable to read MoltNet config at ${join(configDir, 'moltnet.json')}`,
    );
  });
});

// Traversal must be rejected through the paths an attacker can actually reach —
// the environment variable and the on-disk selector — not only via the helper.
// These are the two places an untrusted alias becomes a credential path.
describe('untrusted aliases through the real resolution ladder', () => {
  const hostile = [
    '../escape',
    '../../etc',
    '/absolute',
    'has/slash',
    '.hidden',
  ];

  it('rejects a hostile MOLTNET_ACTIVE_IDENTITY', async () => {
    await freshHome();
    for (const alias of hostile) {
      process.env.MOLTNET_ACTIVE_IDENTITY = alias;
      await expect(resolveConfigDir()).rejects.toThrow(
        /invalid identity alias/,
      );
      await expect(readConfig()).rejects.toThrow(/invalid identity alias/);
    }
  });

  it('rejects a hostile default in identity-selector.json', async () => {
    for (const alias of hostile) {
      await freshHome();
      delete process.env.MOLTNET_ACTIVE_IDENTITY;
      await writeFile(
        join(getConfigDir(), 'identity-selector.json'),
        JSON.stringify({ version: 1, default_identity: alias }),
      );
      await expect(resolveConfigDir()).rejects.toThrow(
        /invalid identity alias/,
      );
    }
  });
});

describe('writeConfig boundaries', () => {
  it('seeds the selector so a JS-created identity is reachable', async () => {
    await freshHome();
    process.env.MOLTNET_ACTIVE_IDENTITY = 'first';
    await writeConfig(credentials('first'), getIdentityDir('first'));

    // The selector is what every other consumer reads; without it the identity
    // exists but only this process can find it.
    delete process.env.MOLTNET_ACTIVE_IDENTITY;
    expect(await resolveConfigDir()).toBe(getIdentityDir('first'));
    expect((await readConfig())?.subject_id).toBe('first');
  });

  it('never overwrites an existing default', async () => {
    await freshHome();
    await writeFile(
      join(getConfigDir(), 'identity-selector.json'),
      JSON.stringify({ version: 1, default_identity: 'chosen' }),
    );
    await writeConfig(credentials('other'), getIdentityDir('other'));

    const selector = JSON.parse(
      await readFile(join(getConfigDir(), 'identity-selector.json'), 'utf-8'),
    );
    expect(selector.default_identity).toBe('chosen');
  });

  it('refuses to write when no identity is selected, touching nothing', async () => {
    const home = await freshHome();
    await expect(writeConfig(credentials('nobody'))).rejects.toThrow();

    // The rejection must not leave a partial store behind.
    const entries = await readdir(getConfigDir());
    expect(entries).toEqual([]);
    expect(home).toBeTruthy();
  });
});
