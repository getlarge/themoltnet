import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractRuntimeModule,
  loadDaemonRuntimeAdapter,
  resolveRuntimeModuleUrl,
} from './runtime-loader.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('extractRuntimeModule', () => {
  it('keeps the built-in runtime when the flag is absent', () => {
    expect(extractRuntimeModule(['poll', '--profile', 'default'])).toEqual({
      argv: ['poll', '--profile', 'default'],
      specifier: undefined,
    });
  });

  it.each([
    [['--runtime', './runtime.mjs', 'poll'], ['poll'], './runtime.mjs'],
    [
      ['poll', '--runtime=@acme/moltnet-runtime'],
      ['poll'],
      '@acme/moltnet-runtime',
    ],
  ])(
    'extracts a trusted runtime module from %j',
    (argv, remaining, specifier) => {
      expect(extractRuntimeModule(argv)).toEqual({
        argv: remaining,
        specifier,
      });
    },
  );

  it('does not interpret arguments after the option terminator', () => {
    expect(
      extractRuntimeModule(['poll', '--', '--runtime', 'task-value']),
    ).toEqual({
      argv: ['poll', '--', '--runtime', 'task-value'],
      specifier: undefined,
    });
  });

  it('rejects missing and duplicate runtime flags', () => {
    expect(() => extractRuntimeModule(['poll', '--runtime'])).toThrow(
      'Missing value for --runtime',
    );
    expect(() =>
      extractRuntimeModule([
        '--runtime',
        './one.mjs',
        'poll',
        '--runtime=./two.mjs',
      ]),
    ).toThrow('--runtime may be specified only once');
  });
});

describe('loadDaemonRuntimeAdapter', () => {
  it('loads a local module relative to the operator working directory', async () => {
    const directory = await createTemporaryDirectory();
    await writeAdapterModule(join(directory, 'runtime.mjs'), 'local_pi');

    const adapter = await loadDaemonRuntimeAdapter('./runtime.mjs', {
      cwd: directory,
    });

    expect(adapter.runtimeKind).toBe('local_pi');
    expect(resolveRuntimeModuleUrl('./runtime.mjs', directory)).toMatch(
      /^file:/,
    );
  });

  it('resolves an installed runtime package from the operator project', async () => {
    const directory = await createTemporaryDirectory();
    const packageDirectory = join(
      directory,
      'node_modules',
      '@acme',
      'moltnet-runtime',
    );
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: '@acme/moltnet-runtime',
        type: 'module',
        exports: { '.': { default: './index.js' } },
      }),
    );
    await writeAdapterModule(join(packageDirectory, 'index.js'), 'package_pi');

    const adapter = await loadDaemonRuntimeAdapter('@acme/moltnet-runtime', {
      cwd: directory,
    });

    expect(adapter.runtimeKind).toBe('package_pi');
  });

  it('rejects modules that do not default-export an adapter', async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, 'runtime.mjs'),
      'export default { runtimeKind: "missing_prepare" };',
    );

    await expect(
      loadDaemonRuntimeAdapter('./runtime.mjs', { cwd: directory }),
    ).rejects.toThrow('must default-export a DaemonRuntimeAdapter');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'moltnet-runtime-loader-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeAdapterModule(
  path: string,
  runtimeKind: string,
): Promise<void> {
  await writeFile(
    path,
    `export default {
      runtimeKind: ${JSON.stringify(runtimeKind)},
      async prepare() { throw new Error('not called by loader tests'); }
    };`,
  );
}
