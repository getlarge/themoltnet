import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConfigDir } from '../src/config.js';
import { storeSecretService } from '../src/store-root.js';

describe('MoltNet store selection', () => {
  it.skipIf(process.platform === 'win32')(
    'agrees with Go on keyring service names',
    () => {
      const rows = readFileSync(
        new URL(
          '../../../test-fixtures/store-secret-service-conformance.tsv',
          import.meta.url,
        ),
        'utf8',
      );
      for (const row of rows
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))) {
        const [root, digest] = row.split('\t');
        expect(storeSecretService({ root })).toBe(
          `themolt.net/store/${digest}`,
        );
      }
    },
  );
  let home: string;
  beforeEach(() => {
    home = realpathSync.native(mkdtempSync(join(tmpdir(), 'moltnet-store-')));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('MOLTNET_HOME', undefined);
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves symlinks before parent segments', () => {
    mkdirSync(join(home, 'real/nested'), { recursive: true });
    symlinkSync(join(home, 'real/nested'), join(home, 'link'), 'dir');
    expect(getConfigDir({ root: 'link/../new', cwd: home })).toBe(
      join(home, 'real/new'),
    );
  });
  it('preserves the lexical default through an aliased home', () => {
    mkdirSync(join(home, 'real/.config/moltnet'), { recursive: true });
    symlinkSync(join(home, 'real'), join(home, 'alias'), 'dir');
    expect(getConfigDir({ home: join(home, 'alias') })).toBe(
      join(home, 'alias/.config/moltnet'),
    );
    expect(storeSecretService({ home: join(home, 'alias') })).toBe(
      'themolt.net',
    );
  });
  it('uses on-disk case on case-insensitive volumes', (ctx) => {
    mkdirSync(join(home, 'CaseStore'));
    if (!existsSync(join(home, 'casestore'))) ctx.skip();
    expect(getConfigDir({ root: join(home, 'casestore') })).toBe(
      join(home, 'CaseStore'),
    );
    expect(storeSecretService({ root: join(home, 'casestore') })).toBe(
      storeSecretService({ root: join(home, 'CaseStore') }),
    );
  });
  it('keeps default config lookup lexical even when .config is a file', () => {
    writeFileSync(join(home, '.config'), 'fixture');
    expect(getConfigDir()).toBe(join(home, '.config/moltnet'));
    expect(storeSecretService()).toBe('themolt.net');
    expect(storeSecretService({ root: join(home, 'isolated') })).toMatch(
      /^themolt\.net\/store\/[a-f0-9]{64}$/,
    );
  });
  it.skipIf(process.platform === 'win32')(
    'resolves traverse-only directories',
    (ctx) => {
      const actual = join(home, 'CaseStore');
      mkdirSync(actual);
      const alias = existsSync(join(home, 'casestore'))
        ? join(home, 'casestore')
        : actual;
      chmodSync(actual, 0o111);
      try {
        let readable = false;
        try {
          readdirSync(actual);
          readable = true;
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe('EACCES');
        }
        if (readable)
          ctx.skip('filesystem or user bypasses directory read permissions');
        expect(getConfigDir({ root: join(alias, 'new') })).toBe(
          join(actual, 'new'),
        );
      } finally {
        chmodSync(actual, 0o700);
      }
    },
  );
  it('labels namespace selection errors with the environment source', () => {
    expect(() =>
      storeSecretService({ env: { MOLTNET_HOME: 'bad\u0000root' } }),
    ).toThrow('Invalid MoltNet store root (MOLTNET_HOME)');
  });
  it('retains the established default', () => {
    expect(getConfigDir()).toBe(join(home, '.config/moltnet'));
  });
  it('accepts the legacy root alias and diagnoses conflicting roots', () => {
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', join(home, 'legacy'));
    expect(getConfigDir()).toBe(join(home, 'legacy'));
    vi.stubEnv('MOLTNET_HOME', join(home, 'different'));
    expect(() => getConfigDir()).toThrow(/conflict/i);
    expect(getConfigDir({ root: join(home, 'explicit') })).toBe(
      join(home, 'explicit'),
    );
  });
  it('conforms to shared full-store alias fixtures', () => {
    const rows = readFileSync(
      new URL(
        '../../../test-fixtures/store-alias-conformance.tsv',
        import.meta.url,
      ),
      'utf8',
    );
    for (const row of rows
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))) {
      const [shared, alias, expected] = row.split('\t');
      const env = {
        MOLTNET_HOME: shared === 'UNSET' ? undefined : shared,
        MOLTNET_AGENT_SERVER_ROOT: alias === 'UNSET' ? undefined : alias,
      };
      const options = { env, cwd: home, home };
      if (expected === 'ERROR') {
        expect(() => getConfigDir(options)).toThrow();
        expect(() => storeSecretService(options)).toThrow();
      } else {
        expect(getConfigDir(options)).toBe(join(home, expected!));
        expect(storeSecretService(options)).toBe(
          storeSecretService({ root: join(home, expected!), home }),
        );
      }
    }
  });
  it('names both conflicting selections', () => {
    expect(() =>
      getConfigDir({
        env: {
          MOLTNET_HOME: 'first-store',
          MOLTNET_AGENT_SERVER_ROOT: 'second-store',
        },
      }),
    ).toThrow(/first-store.*second-store/);
  });
  it.each(['\n', '\r\n'])(
    'conforms to root fixtures with %j line endings',
    (newline) => {
      const rows = readFileSync(
        new URL(
          '../../../test-fixtures/store-root-conformance.tsv',
          import.meta.url,
        ),
        'utf8',
      ).replace(/\r?\n/g, newline);
      for (const row of rows
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))) {
        const [root, expected] = row.split('\t');
        const read = () => getConfigDir({ root, cwd: home });
        if (expected === 'ERROR') expect(read).toThrow();
        else expect(read()).toBe(join(home, expected!));
      }
    },
  );
  it('lets an explicit root override even an invalid environment root', () => {
    vi.stubEnv('MOLTNET_HOME', '');
    expect(getConfigDir({ root: join(home, 'explicit') })).toBe(
      join(home, 'explicit'),
    );
  });
  it('keeps the default keyring namespace through a symlink alias', () => {
    mkdirSync(join(home, '.config/moltnet'), { recursive: true });
    symlinkSync(
      join(home, '.config/moltnet'),
      join(home, 'default-alias'),
      'dir',
    );
    expect(storeSecretService({ root: join(home, 'default-alias') })).toBe(
      'themolt.net',
    );
    expect(storeSecretService({ root: join(home, 'a') })).not.toBe(
      storeSecretService({ root: join(home, 'b') }),
    );
  });
  it('selects the store itself, without appending .config/moltnet', () => {
    vi.stubEnv('MOLTNET_HOME', join(home, 'isolated'));
    expect(getConfigDir()).toBe(join(home, 'isolated'));
  });
  it('resolves relative roots against the caller directory', () => {
    vi.stubEnv('MOLTNET_HOME', 'relative-store');
    expect(getConfigDir()).toBe(
      join(realpathSync.native(process.cwd()), 'relative-store'),
    );
  });
  it('canonicalizes existing ancestors for a not-yet-created store', () => {
    mkdirSync(join(home, 'real'));
    symlinkSync(join(home, 'real'), join(home, 'alias'), 'dir');
    vi.stubEnv('MOLTNET_HOME', join(home, 'alias', 'new-store'));
    expect(getConfigDir()).toBe(join(home, 'real', 'new-store'));
  });
  it.each(['', '   '])('rejects invalid explicit roots: %j', (root) => {
    vi.stubEnv('MOLTNET_HOME', root);
    expect(() => getConfigDir()).toThrow();
  });
  it('rejects NUL in a programmatic root (OS environment strings cannot contain NUL)', () => {
    expect(() => getConfigDir({ root: 'bad\u0000root' })).toThrow();
  });
  it('rejects files and descendants of files', () => {
    writeFileSync(join(home, 'file'), 'fixture');
    vi.stubEnv('MOLTNET_HOME', join(home, 'file', 'store'));
    expect(() => getConfigDir()).toThrow();
  });
});
