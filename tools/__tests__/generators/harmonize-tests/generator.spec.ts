import type { Tree } from '@nx/devkit';
import { addProjectConfiguration, readJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import harmonizeTestsGenerator, {
  transformConfigString,
} from '../../../generators/harmonize-tests/index';

describe('harmonize-tests generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'lib', { root: 'libs/lib' });
    tree.write(
      'libs/lib/package.json',
      JSON.stringify({ name: 'lib', exports: { '.': './src/index.ts' } }),
    );
    tree.write('libs/lib/src/index.ts', "export * from './a.js';\n");
    tree.write('libs/lib/src/a.ts', 'export const a = 1;\n');
    // Sorts before the test that imports it, so it moves first.
    tree.write(
      'libs/lib/src/__tests__/fixtures.ts',
      'export const fixture = 1;\n',
    );
    tree.write(
      'libs/lib/src/z.test.ts',
      [
        "import { a } from './a.js';",
        "import { fixture } from './__tests__/fixtures.js';",
        '',
      ].join('\n'),
    );
    tree.write(
      'libs/lib/vitest.config.ts',
      "export default { test: { include: ['src/**/*.test.ts'] } };\n",
    );
    tree.write(
      'libs/lib/tsconfig.spec.json',
      JSON.stringify({
        compilerOptions: { rootDir: './src' },
        include: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      }),
    );
  });

  it('moves tests and helpers and repoints imports to moved files', async () => {
    // Act
    await harmonizeTestsGenerator(tree, { project: 'lib', skipFormat: true });

    // Assert
    expect(tree.exists('libs/lib/src/z.test.ts')).toBe(false);
    expect(tree.read('libs/lib/__tests__/z.spec.ts', 'utf-8')).toBe(
      [
        "import { a } from '../src/a.js';",
        "import { fixture } from './fixtures.js';",
        '',
      ].join('\n'),
    );
    expect(tree.exists('libs/lib/__tests__/fixtures.ts')).toBe(true);
    expect(tree.read('libs/lib/vitest.config.ts', 'utf-8')).toContain(
      "'__tests__/**/*.spec.ts'",
    );
    expect(readJson(tree, 'libs/lib/tsconfig.spec.json')).toEqual({
      compilerOptions: { rootDir: '.' },
      include: ['__tests__/**/*.ts', 'src/**/*.d.ts'],
    });
  });

  it('keeps test-only helpers in src/ when they are run by name', async () => {
    // Arrange
    tree.write(
      'libs/lib/package.json',
      JSON.stringify({ name: 'lib', bin: { lib: './src/harness.ts' } }),
    );
    tree.write('libs/lib/src/harness.ts', 'export const h = 1;\n');
    tree.write('libs/lib/src/test-cli.ts', '#!/usr/bin/env node\n');
    tree.write(
      'libs/lib/src/argv-fixture.ts',
      'export const args = process.argv.slice(2);\n',
    );
    tree.write('libs/lib/src/data-fixtures.ts', 'export const d = 1;\n');
    tree.write(
      'libs/lib/src/y.test.ts',
      [
        "import './argv-fixture.js';",
        "import './data-fixtures.js';",
        "import './harness.js';",
        "import './test-cli.js';",
        '',
      ].join('\n'),
    );

    // Act
    await harmonizeTestsGenerator(tree, { project: 'lib', skipFormat: true });

    // Assert
    expect(tree.exists('libs/lib/src/harness.ts')).toBe(true);
    expect(tree.exists('libs/lib/src/test-cli.ts')).toBe(true);
    expect(tree.exists('libs/lib/src/argv-fixture.ts')).toBe(true);
    expect(tree.exists('libs/lib/src/data-fixtures.ts')).toBe(false);
    expect(tree.read('libs/lib/__tests__/y.spec.ts', 'utf-8')).toBe(
      [
        "import '../src/argv-fixture.js';",
        "import './data-fixtures.js';",
        "import '../src/harness.js';",
        "import '../src/test-cli.js';",
        '',
      ].join('\n'),
    );
  });

  it('adds __tests__/ to a spec tsconfig that only includes directories', async () => {
    // Arrange
    tree.write(
      'libs/lib/tsconfig.spec.json',
      JSON.stringify({ include: ['src'] }),
    );

    // Act
    await harmonizeTestsGenerator(tree, { project: 'lib', skipFormat: true });

    // Assert
    expect(readJson(tree, 'libs/lib/tsconfig.spec.json').include).toEqual([
      'src',
      '__tests__/**/*.ts',
    ]);
  });
});

describe('transformConfigString', () => {
  const options = { e2e: false, moves: new Map<string, string>() };

  it.each([
    ['!src/**/*.test.ts', '!__tests__/**/*.spec.ts'],
    ['{projectRoot}/src/**/*.test.ts', '{projectRoot}/__tests__/**/*.spec.ts'],
    [
      '!{projectRoot}/src/**/*.test.ts',
      '!{projectRoot}/__tests__/**/*.spec.ts',
    ],
    ['node --test tests/*.test.mjs', 'node --test __tests__/*.spec.mjs'],
  ])('%s → %s', (input, expected) => {
    // Act & Assert
    expect(transformConfigString(input, options)).toBe(expected);
  });
});
