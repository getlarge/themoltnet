import { describe, expect, it } from 'vitest';

import {
  extractReferences,
  isTestFile,
  planMoves,
  relocateUnderTests,
  renameTestSuffix,
  rewriteReferences,
  transformTestGlob,
} from '../../../generators/harmonize-tests/plan';

describe('renameTestSuffix', () => {
  it.each([
    ['foo.test.ts', 'foo.spec.ts'],
    ['foo.test.tsx', 'foo.spec.tsx'],
    ['foo.test.mjs', 'foo.spec.mjs'],
    ['foo.integration.test.ts', 'foo.integration.spec.ts'],
    ['foo.e2e.test.ts', 'foo.e2e.spec.ts'],
    ['foo.e2e.ts', 'foo.e2e.spec.ts'],
    ['foo.spec.ts', 'foo.spec.ts'],
    ['foo.e2e.spec.ts', 'foo.e2e.spec.ts'],
  ])('%s → %s', (input, expected) => {
    // Act & Assert
    expect(renameTestSuffix(input)).toBe(expected);
  });
});

describe('isTestFile', () => {
  it('excludes declarations and configs', () => {
    // Assert
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.e2e.ts')).toBe(true);
    expect(isTestFile('src/a.test.d.ts')).toBe(false);
    expect(isTestFile('tsconfig.spec.json')).toBe(false);
  });
});

describe('relocateUnderTests', () => {
  it.each([
    ['src/lib/foo.spec.ts', '__tests__/lib/foo.spec.ts'],
    ['src/__tests__/setup.ts', '__tests__/setup.ts'],
    ['src/lib/__tests__/foo.spec.ts', '__tests__/lib/foo.spec.ts'],
    ['tests/plugin.spec.mjs', '__tests__/plugin.spec.mjs'],
    ['__tests__/foo.spec.ts', '__tests__/foo.spec.ts'],
    ['release/cli/install.spec.mjs', '__tests__/release/cli/install.spec.mjs'],
  ])('%s → %s', (input, expected) => {
    // Act & Assert
    expect(relocateUnderTests(input)).toBe(expected);
  });
});

describe('planMoves', () => {
  const project = { name: 'lib', root: 'libs/lib' };

  it('renames in place for e2e projects', () => {
    // Arrange
    const e2e = { name: 'x-e2e', root: 'apps/x-e2e' };

    // Act
    const plan = planMoves({
      projects: [{ project: e2e, files: ['src/a.e2e.ts', 'src/b.spec.ts'] }],
      referencesOf: () => [],
      pinnedFiles: () => new Set(),
      usesTestFramework: () => false,
    });

    // Assert
    expect([...plan.moves]).toEqual([
      ['apps/x-e2e/src/a.e2e.ts', 'apps/x-e2e/src/a.e2e.spec.ts'],
    ]);
  });

  it('moves marked helpers only referenced by tests, transitively', () => {
    // Arrange
    const refs: Record<string, string[]> = {
      'src/a.test.ts': [
        'src/a.ts',
        'src/cli.ts',
        'src/mock-server.ts',
        'src/test-fixtures.ts',
      ],
      'src/test-fixtures.ts': ['src/fixture-data.ts'],
      'src/index.ts': ['src/a.ts'],
    };

    // Act
    const plan = planMoves({
      projects: [
        {
          project,
          files: [
            'src/a.ts',
            'src/a.test.ts',
            'src/cli.ts',
            'src/index.ts',
            'src/mock-server.ts',
            'src/test-fixtures.ts',
            'src/fixture-data.ts',
            'src/test-setup.ts',
          ],
        },
      ],
      referencesOf: (_, file) => refs[file] ?? [],
      pinnedFiles: () => new Set(['src/index.ts']),
      usesTestFramework: (_, file) => file === 'src/mock-server.ts',
    });

    // Assert
    expect(plan.support).toEqual([
      'libs/lib/src/fixture-data.ts',
      'libs/lib/src/mock-server.ts',
      'libs/lib/src/test-fixtures.ts',
      'libs/lib/src/test-setup.ts',
    ]);
    expect(plan.moves.get('libs/lib/src/a.test.ts')).toBe(
      'libs/lib/__tests__/a.spec.ts',
    );
    expect(plan.moves.has('libs/lib/src/a.ts')).toBe(false);
    expect(plan.moves.has('libs/lib/src/cli.ts')).toBe(false);
  });

  it('moves Vitest snapshots with their test', () => {
    // Act
    const plan = planMoves({
      projects: [
        {
          project,
          files: [
            'src/prompts/snapshot.test.ts',
            'src/prompts/__snapshots__/snapshot.test.ts.snap',
          ],
        },
      ],
      referencesOf: () => [],
      pinnedFiles: () => new Set(),
      usesTestFramework: () => false,
    });

    // Assert
    expect(
      plan.moves.get(
        'libs/lib/src/prompts/__snapshots__/snapshot.test.ts.snap',
      ),
    ).toBe('libs/lib/__tests__/prompts/__snapshots__/snapshot.spec.ts.snap');
  });

  it('refuses two sources mapping to one target', () => {
    // Act & Assert
    expect(() =>
      planMoves({
        projects: [
          { project, files: ['src/a.test.ts', '__tests__/a.test.ts'] },
        ],
        referencesOf: () => [],
        pinnedFiles: () => new Set(),
        usesTestFramework: () => false,
      }),
    ).toThrow(/both map to __tests__\/a\.spec\.ts/);
  });
});

describe('rewriteReferences', () => {
  const files = new Set([
    'libs/lib/src/lib/foo.ts',
    'libs/lib/src/lib/foo.test.ts',
    'libs/lib/src/lib/helpers.ts',
    'libs/lib/package.json',
  ]);
  const moves = new Map([
    ['libs/lib/src/lib/foo.test.ts', 'libs/lib/__tests__/lib/foo.spec.ts'],
    ['libs/lib/src/lib/helpers.ts', 'libs/lib/__tests__/lib/helpers.ts'],
  ]);

  it('repoints imports, mocks and import.meta paths from the new location', () => {
    // Arrange
    const code = [
      "import { foo } from './foo.js';",
      "import { help } from './helpers.js';",
      "vi.mock('./foo.js');",
      "const pkg = new URL('../../package.json', import.meta.url);",
      "const fixture = join(import.meta.dirname, '..', 'fixtures', 'a.json');",
      'const dir = import.meta.dirname;',
    ].join('\n');

    // Act
    const result = rewriteReferences({
      code,
      oldFile: 'libs/lib/src/lib/foo.test.ts',
      newFile: 'libs/lib/__tests__/lib/foo.spec.ts',
      moves,
      exists: (p) => files.has(p),
    });

    // Assert
    expect(result.code.split('\n')).toEqual([
      "import { foo } from '../../src/lib/foo.js';",
      "import { help } from './helpers.js';",
      "vi.mock('../../src/lib/foo.js');",
      "const pkg = new URL('../../package.json', import.meta.url);",
      "const fixture = join(import.meta.dirname, '../../src/fixtures/a.json');",
      'const dir = import.meta.dirname;',
    ]);
    expect(result.unresolved).toEqual([
      { line: 6, text: 'const dir = import.meta.dirname;' },
    ]);
  });

  it('keeps a trailing slash for directory URLs', () => {
    // Act
    const result = rewriteReferences({
      code: "const here = new URL('.', import.meta.url);",
      oldFile: 'libs/lib/src/lib/foo.test.ts',
      newFile: 'libs/lib/__tests__/lib/foo.spec.ts',
      moves,
      exists: (p) => files.has(p),
    });

    // Assert
    expect(result.code).toBe(
      "const here = new URL('../../src/lib/', import.meta.url);",
    );
  });

  it('updates files that stay put but import a moved file', () => {
    // Act
    const result = rewriteReferences({
      code: "export * from './lib/helpers';",
      oldFile: 'libs/lib/src/other.test.ts',
      newFile: 'libs/lib/src/other.test.ts',
      moves,
      exists: (p) => files.has(p),
    });

    // Assert
    expect(result.code).toBe("export * from '../__tests__/lib/helpers';");
  });
});

describe('extractReferences', () => {
  it('ignores package specifiers and non-literal URLs', () => {
    // Act
    const { references, unresolved } = extractReferences(
      'a.ts',
      "import x from 'vitest';\nconst u = new URL(name, import.meta.url);",
    );

    // Assert
    expect(references).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });
});

describe('transformTestGlob', () => {
  const moves = new Map([['src/test-setup.ts', '__tests__/test-setup.ts']]);

  it.each([
    ['src/**/*.test.ts', false, '__tests__/**/*.spec.ts'],
    ['src/**/*.{test,spec}.ts', false, '__tests__/**/*.spec.ts'],
    [
      '__tests__/**/*.integration.test.ts',
      false,
      '__tests__/**/*.integration.spec.ts',
    ],
    ['src/**/__tests__/setup.ts', false, '__tests__/setup.ts'],
    ['tests/*.test.mjs', false, '__tests__/*.spec.mjs'],
    ['./src/test-setup.ts', false, './__tests__/test-setup.ts'],
    ['src/**/*.e2e.ts', true, 'src/**/*.e2e.spec.ts'],
    ['src/**/*.e2e.test.ts', true, 'src/**/*.e2e.spec.ts'],
    [
      '{src,tests}/**/*.{test,spec}.{ts,tsx}',
      false,
      '__tests__/**/*.spec.{ts,tsx}',
    ],
    ['src/**/*.ts', false, 'src/**/*.ts'],
    ['vitest', false, 'vitest'],
  ])('%s (e2e=%s) → %s', (glob, e2e, expected) => {
    // Act & Assert
    expect(transformTestGlob(glob, { e2e, moves })).toBe(expected);
  });
});

describe('rewriteReferences for files that stay put', () => {
  it('leaves references to unmoved targets untouched', () => {
    // Act
    const result = rewriteReferences({
      code: "const root = new URL('.', import.meta.url);",
      oldFile: 'apps/x-e2e/run.mjs',
      newFile: 'apps/x-e2e/run.mjs',
      moves: new Map(),
      exists: () => false,
    });

    // Assert
    expect(result.changed).toBe(false);
  });
});
