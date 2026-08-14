import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkNoMissingRelativeJsImports,
  checkPublishedEntryPoints,
  checkRepositoryMetadata,
} from './check-pack.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('checkNoMissingRelativeJsImports', () => {
  it('accepts static and dynamic relative imports included in the tarball', () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'check-pack-imports-'));
    tempDirs.push(pkgDir);
    mkdirSync(join(pkgDir, 'dist', 'assets'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'dist', 'index.js'),
      [
        "// import './comment-only.js';",
        "import './side-effect.js';",
        "export { value } from './value.js';",
        "export const lazy = () => import('./assets/lazy.js');",
        "export const commonjs = require('./common.cjs');",
        "export const wasm = new URL('./assets/parser.wasm', import.meta.url);",
      ].join('\n'),
    );
    for (const path of [
      'dist/side-effect.js',
      'dist/value.js',
      'dist/assets/lazy.js',
      'dist/assets/parser.wasm',
      'dist/common.cjs',
    ]) {
      writeFileSync(join(pkgDir, path), 'export const value = true;');
    }
    const paths = [
      'dist/index.js',
      'dist/side-effect.js',
      'dist/value.js',
      'dist/assets/lazy.js',
      'dist/assets/parser.wasm',
      'dist/common.cjs',
    ];

    const errors = checkNoMissingRelativeJsImports(pkgDir, paths);

    expect(errors).toEqual([]);
  });

  it('rejects a generated chunk omitted from the tarball', () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'check-pack-imports-'));
    tempDirs.push(pkgDir);
    mkdirSync(join(pkgDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'dist', 'cli.js'),
      'const load = () => import("./assets/keyring.js");',
    );

    const errors = checkNoMissingRelativeJsImports(pkgDir, ['dist/cli.js']);

    expect(errors).toEqual([
      'relative JavaScript imports missing from tarball: dist/cli.js -> ./assets/keyring.js (dist/assets/keyring.js)',
    ]);
  });
});

describe('checkPublishedEntryPoints', () => {
  it('validates effective publishConfig exports plus main, types, and bins', () => {
    const pkg = {
      main: './dist/cli.js',
      types: './dist/cli.d.ts',
      exports: { '.': './src/cli.ts' },
      publishConfig: {
        exports: {
          '.': {
            import: './dist/cli.js',
            types: './dist/cli.d.ts',
          },
          './runtime': './dist/runtime.js',
        },
      },
      bin: { 'moltnet-agent': './dist/main.js' },
    };

    const errors = checkPublishedEntryPoints(pkg, [
      'dist/cli.js',
      'dist/cli.d.ts',
      'dist/runtime.js',
      'dist/main.js',
    ]);

    expect(errors).toEqual([]);
  });

  it('rejects binary package entries and source exports omitted from tarball', () => {
    const pkg = {
      main: './dist/main.js',
      exports: { '.': './src/index.ts' },
      bin: { tool: './dist/main.js' },
    };

    const errors = checkPublishedEntryPoints(pkg, []);

    expect(errors).toEqual([
      'main points to ./dist/main.js but dist/main.js is missing from tarball',
      'bin.tool points to ./dist/main.js but dist/main.js is missing from tarball',
      'exports["."] points to ./src/index.ts but src/index.ts is missing from tarball',
    ]);
  });
});

describe('checkRepositoryMetadata', () => {
  it.each([
    'git+https://github.com/getlarge/themoltnet.git',
    'https://github.com/getlarge/themoltnet.git',
  ])('accepts the MoltNet repository URL form %s', (url) => {
    const pkg = {
      repository: {
        type: 'git',
        url,
        directory: 'libs/example',
      },
    };

    const errors = checkRepositoryMetadata(pkg, 'libs/example');

    expect(errors).toEqual([]);
  });

  it('rejects missing repository metadata', () => {
    const errors = checkRepositoryMetadata({}, 'libs/example');

    expect(errors).toEqual([
      'repository metadata missing (npm provenance requires the canonical repository object for libs/example)',
    ]);
  });

  it('rejects provenance URL and monorepo directory mismatches', () => {
    const pkg = {
      repository: {
        type: 'svn',
        url: 'https://github.com/getlarge/another-repo',
        directory: 'libs/elsewhere',
      },
    };

    const errors = checkRepositoryMetadata(pkg, 'libs/example');

    expect(errors).toEqual([
      'repository.type must be "git"',
      'repository.url must identify https://github.com/getlarge/themoltnet',
      'repository.directory must be "libs/example" (got "libs/elsewhere")',
    ]);
  });
});
