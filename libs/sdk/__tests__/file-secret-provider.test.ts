import { readFileSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SECRET_MAX_BYTES,
  FileSecretProvider,
  FileSecretProviderError,
  fileSecretProviderOptionsFromEnv,
  validateFileSecretKey,
} from '../src/file-secret-provider.js';

const tempDirs: string[] = [];
const envLookup = (env: Record<string, string | undefined>) => (name: string) =>
  env[name];
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moltnet-secret-root-'));
  tempDirs.push(dir);
  return dir;
}
async function putFile(
  root: string,
  rel: string,
  content: string,
  mode = 0o400,
) {
  const path = join(root, rel);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, mode);
}
async function failure(
  promise: Promise<unknown>,
): Promise<FileSecretProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FileSecretProviderError);
  return error as FileSecretProviderError;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe('validateFileSecretKey', () => {
  it('accepts canonical logical keys', () => {
    expect(() =>
      validateFileSecretKey('github-app/123/private-key'),
    ).not.toThrow();
    expect(() => validateFileSecretKey('a.b_c-d/E')).not.toThrow();
  });

  it('rejects traversal, absolute paths, and odd segments', () => {
    for (const key of [
      '',
      '/etc/passwd',
      'C:\\x',
      '../e',
      'a/../b',
      'a//b',
      'a/./b',
      't/',
      'nul\0b',
      'a b',
      '秘密',
    ]) {
      expect(() => validateFileSecretKey(key), key).toThrow(
        FileSecretProviderError,
      );
    }
  });
});

describe('fileSecretProviderOptionsFromEnv', () => {
  it('reads root, writable flag, and max bytes', () => {
    expect(
      fileSecretProviderOptionsFromEnv(
        envLookup({
          MOLTNET_SECRET_ROOT: '/run/secrets',
          MOLTNET_SECRET_ROOT_WRITABLE: '1',
          MOLTNET_SECRET_MAX_BYTES: '1024',
        }),
        'linux',
      ),
    ).toEqual({
      root: '/run/secrets',
      writable: true,
      maxBytes: 1024,
      platform: 'linux',
    });
    expect(fileSecretProviderOptionsFromEnv(envLookup({}), 'linux')).toEqual({
      root: undefined,
      writable: false,
      maxBytes: DEFAULT_SECRET_MAX_BYTES,
      platform: 'linux',
    });
  });

  it('ignores a non-numeric or non-positive max bytes', () => {
    expect(
      fileSecretProviderOptionsFromEnv(
        envLookup({ MOLTNET_SECRET_MAX_BYTES: 'abc' }),
        'linux',
      ).maxBytes,
    ).toBe(DEFAULT_SECRET_MAX_BYTES);
    expect(
      fileSecretProviderOptionsFromEnv(
        envLookup({ MOLTNET_SECRET_MAX_BYTES: '0' }),
        'linux',
      ).maxBytes,
    ).toBe(DEFAULT_SECRET_MAX_BYTES);
  });
});

describe('FileSecretProvider.read', () => {
  it('is unavailable without a root and probes as inaccessible', async () => {
    const provider = new FileSecretProvider({ platform: 'linux' });
    expect(provider.name).toBe('file');
    expect(provider.capabilities).toEqual({
      read: true,
      write: false,
      delete: false,
    });
    expect((await failure(provider.read('k'))).code).toBe(
      'provider_unavailable',
    );
    await expect(provider.probe('k')).resolves.toBe('inaccessible');
  });

  it('reads a regular file and strips one trailing newline', async () => {
    const root = await tempRoot();
    await putFile(root, 'agent-key/identity-1', 'value-1\n');
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    await expect(provider.read('agent-key/identity-1')).resolves.toBe(
      'value-1',
    );
    await expect(provider.probe('agent-key/identity-1')).resolves.toBe(
      'present',
    );
  });

  it('returns null for a missing key and probes absent', async () => {
    const root = await tempRoot();
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    await expect(provider.read('absent/key')).resolves.toBeNull();
    await expect(provider.probe('absent/key')).resolves.toBe('absent');
  });

  it('follows a kubernetes projected-volume chain inside the root', async () => {
    const root = await tempRoot();
    await putFile(root, '..2026/github-app/1/private-key', 'pem', 0o444);
    await symlink('..2026', join(root, '..data'));
    await symlink('..data/github-app', join(root, 'github-app'));
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    await expect(provider.read('github-app/1/private-key')).resolves.toBe(
      'pem',
    );
  });

  it('rejects a symlink escaping the root and never reads the target', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await putFile(outside, 'victim', 'outside-canary');
    await symlink(join(outside, 'victim'), join(root, 'k'));
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    const error = await failure(provider.read('k'));
    expect(error.code).toBe('symlink_escape');
    expect(error.message).not.toContain('outside-canary');
    await expect(provider.probe('k')).resolves.toBe('inaccessible');
  });

  it('rejects directories and group/other-writable files', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'dir'), { mode: 0o700 });
    await putFile(root, 'gw', 'v', 0o620);
    await putFile(root, 'ow', 'v', 0o666);
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    expect((await failure(provider.read('dir'))).code).toBe('unsafe_target');
    expect((await failure(provider.read('gw'))).code).toBe('unsafe_target');
    expect((await failure(provider.read('ow'))).code).toBe('unsafe_target');
  });

  it('skips the mode check on windows', async () => {
    const root = await tempRoot();
    await putFile(root, 'ow', 'v', 0o666);
    const provider = new FileSecretProvider({ root, platform: 'win32' });

    await expect(provider.read('ow')).resolves.toBe('v');
  });

  it('rejects oversized files without reading them fully', async () => {
    const root = await tempRoot();
    await putFile(root, 'big', 'x'.repeat(DEFAULT_SECRET_MAX_BYTES + 1), 0o600);
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    expect((await failure(provider.read('big'))).code).toBe('oversized');
  });

  it('rejects write and delete when not writable', async () => {
    const root = await tempRoot();
    const provider = new FileSecretProvider({ root, platform: 'linux' });

    expect((await failure(provider.write('k', 'v'))).code).toBe('read_only');
    expect((await failure(provider.delete('k'))).code).toBe('read_only');
  });
});

type FixtureFile = {
  content?: string;
  contentRepeat?: { char: string; count: number };
  mode: string;
};
type Layout = {
  name: string;
  files?: Record<string, FixtureFile>;
  dirs?: string[];
  outside?: Record<string, string>;
  symlinks?: Record<string, string>;
  key: string;
  expect: { value?: string; error?: string };
  skipOn?: NodeJS.Platform[];
};
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../testdata/keyring-conformance.json', import.meta.url),
    'utf8',
  ),
) as {
  file: {
    keys: Array<{ key: string; valid: boolean; reason?: string }>;
    layouts: Layout[];
  };
};

async function materialize(layout: Layout): Promise<string> {
  const root = await tempRoot();
  const outside = await tempRoot();
  for (const [rel, content] of Object.entries(layout.outside ?? {})) {
    await putFile(outside, rel, content, 0o600);
  }
  for (const rel of layout.dirs ?? []) {
    await mkdir(join(root, rel), { recursive: true, mode: 0o700 });
  }
  for (const [rel, spec] of Object.entries(layout.files ?? {})) {
    const content = spec.contentRepeat
      ? spec.contentRepeat.char.repeat(spec.contentRepeat.count)
      : (spec.content ?? '');
    await putFile(root, rel, content, Number.parseInt(spec.mode, 8));
  }
  for (const [link, target] of Object.entries(layout.symlinks ?? {})) {
    await mkdir(join(root, link, '..'), { recursive: true, mode: 0o700 });
    await symlink(target.replace('<outside>', outside), join(root, link));
  }
  return root;
}

describe('cross-runtime file provider conformance', () => {
  it('agrees with the Go CLI on key validity', () => {
    for (const vector of fixture.file.keys) {
      if (vector.valid) {
        expect(
          () => validateFileSecretKey(vector.key),
          vector.key,
        ).not.toThrow();
      } else {
        expect(() => validateFileSecretKey(vector.key), vector.key).toThrow(
          FileSecretProviderError,
        );
      }
    }
  });

  for (const layout of fixture.file.layouts) {
    it.skipIf(layout.skipOn?.includes(process.platform))(
      `layout: ${layout.name}`,
      async () => {
        const root = await materialize(layout);
        const provider = new FileSecretProvider({
          root,
          platform: process.platform,
        });
        if (layout.expect.error === 'not_found') {
          await expect(provider.read(layout.key)).resolves.toBeNull();
        } else if (layout.expect.error) {
          expect((await failure(provider.read(layout.key))).code).toBe(
            layout.expect.error,
          );
        } else {
          await expect(provider.read(layout.key)).resolves.toBe(
            layout.expect.value,
          );
        }
      },
    );
  }
});

describe('FileSecretProvider writes', () => {
  it('writes atomically with mode 0600 and reads back when writable', async () => {
    const root = await tempRoot();
    const provider = new FileSecretProvider({
      root,
      writable: true,
      platform: 'linux',
    });
    expect(provider.capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
    });

    await provider.write('agent-key/identity-1', 'v1');

    await expect(provider.read('agent-key/identity-1')).resolves.toBe('v1');
    expect((await stat(join(root, 'agent-key/identity-1'))).mode & 0o777).toBe(
      0o600,
    );
  });

  it('refuses to write through a symlink and to delete a non-regular file', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await putFile(outside, 'victim', 'keep', 0o600);
    await symlink(join(outside, 'victim'), join(root, 'k'));
    await mkdir(join(root, 'd'), { mode: 0o700 });
    const provider = new FileSecretProvider({
      root,
      writable: true,
      platform: 'linux',
    });

    expect((await failure(provider.write('k', 'x'))).code).toBe(
      'unsafe_target',
    );
    expect((await failure(provider.delete('d'))).code).toBe('unsafe_target');
  });

  it('deletes a regular file and ignores a missing one', async () => {
    const root = await tempRoot();
    const provider = new FileSecretProvider({
      root,
      writable: true,
      platform: 'linux',
    });
    await provider.write('k', 'v');

    await provider.delete('k');
    await expect(provider.read('k')).resolves.toBeNull();
    await expect(provider.delete('k')).resolves.toBeUndefined();
  });
});
