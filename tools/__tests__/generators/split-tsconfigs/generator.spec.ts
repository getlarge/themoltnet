import type { Tree } from '@nx/devkit';
import { addProjectConfiguration, readJson, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import splitTsconfigsGenerator from '../../../generators/split-tsconfigs/index';

const LIB_TSCONFIG = {
  compilerOptions: {
    composite: true,
    outDir: './out-tsc',
    rootDir: './src',
    tsBuildInfoFile: './out-tsc/tsconfig.tsbuildinfo',
  },
  exclude: ['node_modules', 'dist', '__tests__', 'e2e'],
  extends: './tsconfig.json',
  include: ['src/**/*.ts'],
  references: [],
};

const SPEC_TSCONFIG = {
  compilerOptions: {
    composite: true,
    outDir: './out-tsc/spec',
    rootDir: '.',
    tsBuildInfoFile: './out-tsc/tsconfig.spec.tsbuildinfo',
    types: ['vitest/globals', 'vitest', 'node'],
  },
  extends: './tsconfig.json',
  include: [
    'vitest.config.ts',
    'src/**/*.d.ts',
    '__tests__/**/*.ts',
    '__tests__/**/*.tsx',
  ],
  references: [{ path: './tsconfig.lib.json' }],
};

describe('split-tsconfigs generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('split project without a spec config', () => {
    beforeEach(() => {
      addProjectConfiguration(tree, 'lib', { root: 'libs/lib' });
      tree.write('libs/lib/package.json', JSON.stringify({ name: 'lib' }));
      tree.write('libs/lib/src/index.ts', 'export const a = 1;\n');
      tree.write('libs/lib/__tests__/a.spec.ts', "import '../src/index.js';\n");
      tree.write('libs/lib/vitest.config.ts', 'export default {};\n');
      writeJson(tree, 'libs/lib/tsconfig.json', {
        extends: '../../tsconfig.json',
        files: [],
        include: [],
        references: [{ path: './tsconfig.lib.json' }],
      });
      writeJson(tree, 'libs/lib/tsconfig.lib.json', LIB_TSCONFIG);
    });

    it('adds a spec config covering __tests__ and leaves the lib config alone', async () => {
      // Act
      await splitTsconfigsGenerator(tree, { all: true, skipFormat: true });

      // Assert
      expect(readJson(tree, 'libs/lib/tsconfig.spec.json')).toEqual(
        SPEC_TSCONFIG,
      );
      expect(readJson(tree, 'libs/lib/tsconfig.json').references).toEqual([
        { path: './tsconfig.lib.json' },
        { path: './tsconfig.spec.json' },
      ]);
      expect(readJson(tree, 'libs/lib/tsconfig.lib.json')).toEqual(
        LIB_TSCONFIG,
      );
    });

    it('is idempotent', async () => {
      // Arrange
      await splitTsconfigsGenerator(tree, { all: true, skipFormat: true });
      const glue = tree.read('libs/lib/tsconfig.json', 'utf-8');

      // Act
      await splitTsconfigsGenerator(tree, { all: true, skipFormat: true });

      // Assert
      expect(tree.read('libs/lib/tsconfig.json', 'utf-8')).toBe(glue);
    });

    it('skips a split project without tests', async () => {
      // Arrange
      tree.delete('libs/lib/__tests__/a.spec.ts');

      // Act
      await splitTsconfigsGenerator(tree, { all: true, skipFormat: true });

      // Assert
      expect(tree.exists('libs/lib/tsconfig.spec.json')).toBe(false);
    });
  });

  it('splits an unsplit project with __tests__ into lib and spec configs', async () => {
    // Arrange
    addProjectConfiguration(tree, 'lib', { root: 'libs/lib' });
    tree.write('libs/lib/package.json', JSON.stringify({ name: 'lib' }));
    tree.write('libs/lib/src/index.ts', 'export const a = 1;\n');
    tree.write('libs/lib/__tests__/a.spec.ts', "import '../src/index.js';\n");
    tree.write('libs/lib/vitest.config.ts', 'export default {};\n');
    writeJson(tree, 'libs/lib/tsconfig.json', {
      compilerOptions: { composite: true, outDir: './out-tsc' },
      extends: '../../tsconfig.json',
      include: ['src/**/*.ts'],
    });

    // Act
    await splitTsconfigsGenerator(tree, { project: 'lib', skipFormat: true });

    // Assert
    expect(readJson(tree, 'libs/lib/tsconfig.json').references).toEqual([
      { path: './tsconfig.lib.json' },
      { path: './tsconfig.spec.json' },
    ]);
    expect(readJson(tree, 'libs/lib/tsconfig.spec.json').include).toEqual(
      SPEC_TSCONFIG.include,
    );
  });

  it('leaves an already split e2e project untouched', async () => {
    // Arrange
    addProjectConfiguration(tree, 'app-e2e', { root: 'apps/app-e2e' });
    tree.write('apps/app-e2e/src/a.spec.ts', 'export {};\n');
    const glue = {
      extends: '../../tsconfig.json',
      files: [],
      include: [],
      references: [{ path: './tsconfig.spec.json' }],
    };
    const spec = {
      compilerOptions: { outDir: './out-tsc/spec' },
      extends: './tsconfig.json',
      include: ['src/**/*.ts'],
    };
    writeJson(tree, 'apps/app-e2e/tsconfig.json', glue);
    writeJson(tree, 'apps/app-e2e/tsconfig.spec.json', spec);

    // Act
    await splitTsconfigsGenerator(tree, { all: true, skipFormat: true });

    // Assert
    expect(readJson(tree, 'apps/app-e2e/tsconfig.json')).toEqual(glue);
    expect(readJson(tree, 'apps/app-e2e/tsconfig.spec.json')).toEqual(spec);
  });
});
