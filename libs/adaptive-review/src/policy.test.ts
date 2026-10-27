import { describe, expect, it } from 'vitest';

import {
  matchesPolicyGlob,
  matchesPolicyPaths,
  validatePolicyGlob,
} from './policy.js';

// Policy globs are deliberately not minimatch (`@moltnet/docs-impact-review`
// uses `path.matchesGlob`): matching is linear-time, case-sensitive on every
// platform, and wildcards also match dot names.
describe('policy globs', () => {
  it.each([
    ['nx.json', 'nx.json', true],
    ['nx.json', 'libs/nx.json', false],
    ['*.ts', 'core.ts', true],
    ['*.ts', 'src/core.ts', false],
    ['src/*', 'src/core.ts', true],
    ['src/*', 'src/a/core.ts', false],
    ['tsconfig*.json', 'tsconfig.lib.json', true],
    ['**/tsconfig*.json', 'tsconfig.json', true],
    ['**/tsconfig*.json', 'libs/a/tsconfig.spec.json', true],
    ['src/domain/**', 'src/domain', true],
    ['src/domain/**', 'src/domain/a/b.ts', true],
    ['src/domain/**', 'src/domainx/a.ts', false],
    ['libs/**/src/*.ts', 'libs/src/a.ts', true],
    ['libs/**/src/*.ts', 'libs/a/b/src/c.ts', true],
    ['**', 'any/depth/file', true],
    ['*', '.secretlintignore', true],
    ['**/*.yml', '.github/workflows/ci.yml', true],
    ['*.TS', 'core.ts', false],
  ])('%s matching %s is %s', (pattern, path, expected) => {
    expect(matchesPolicyGlob(path, pattern)).toBe(expected);
  });

  it('stays fast on a pathological segment', () => {
    // A backtracking matcher would exceed the test timeout here.
    expect(matchesPolicyGlob(`${'a'.repeat(5_000)}c`, '*a*a*a*a*a*a*b')).toBe(
      false,
    );
  });

  it('applies excludes after includes', () => {
    expect(
      matchesPolicyPaths(
        'libs/a/package.json',
        ['**/package.json'],
        ['libs/a/**'],
      ),
    ).toBe(false);
    expect(
      matchesPolicyPaths(
        'libs/b/package.json',
        ['**/package.json'],
        ['libs/a/**'],
      ),
    ).toBe(true);
  });

  it.each([
    '/abs/path',
    './relative',
    'back\\slash',
    'a//b',
    'a/./b',
    'a/../b',
    'a**/b',
    'a/b**',
    'file?.ts',
    '{a,b}.ts',
    '[ab].ts',
    '!negated',
  ])('rejects the unsupported pattern %s', (pattern) => {
    expect(() => validatePolicyGlob(pattern)).toThrow(
      `invalid policy glob: ${pattern}`,
    );
  });
});
