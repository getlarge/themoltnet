import { describe, expect, it } from 'vitest';

import { matchesAny, matchesGlob, validateGlob } from './glob.js';

describe('matchesGlob', () => {
  it.each([
    ['**/CHANGELOG.md', 'CHANGELOG.md', true],
    ['**/CHANGELOG.md', 'docs/CHANGELOG.md', true],
    ['apps/cli/**', 'apps/cli/src/flags.ts', true],
    ['apps/cli/**', 'apps/cli-e2e/a.ts', false],
    ['docs/*.md', 'docs/a.md', true],
    ['docs/*.md', 'docs/nested/a.md', false],
    ['docs/*.{md,mdx}', 'docs/a.mdx', true],
    ['docs/[ab].md', 'docs/b.md', true],
    ['docs/a+b.md', 'docs/a+b.md', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    // Act / Assert
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  // The pitfalls the README documents, pinned so a Node change is noticed.
  describe('documented pitfalls', () => {
    it('never lets * or ** reach a name that starts with a dot', () => {
      // Act / Assert
      expect(matchesGlob('.github/CHANGELOG.md', '**/CHANGELOG.md')).toBe(
        false,
      );
      expect(matchesGlob('.github/CHANGELOG.md', '**/.*/**/CHANGELOG.md')).toBe(
        true,
      );
      expect(matchesGlob('x/.claude/skills/a.md', '**/skills/**')).toBe(false);
      expect(matchesGlob('x/.claude/skills/a.md', '**/.*/**/skills/**')).toBe(
        true,
      );
    });

    it('matches whole paths: a directory needs /**', () => {
      // Act / Assert
      expect(matchesGlob('vendor/a.md', 'vendor')).toBe(false);
      expect(matchesGlob('vendor/a.md', 'vendor/**')).toBe(true);
    });
  });
});

describe('matchesAny', () => {
  it('matches when any glob matches and never on an empty list', () => {
    // Act / Assert
    expect(matchesAny('vendor/a.md', ['docs/**', 'vendor/**'])).toBe(true);
    expect(matchesAny('vendor/a.md', [])).toBe(false);
  });
});

describe('validateGlob', () => {
  it.each([
    ['', 'empty'],
    ['!vendor/**', 'negation'],
    ['/docs/**', 'relative to the repository root'],
    ['./docs/**', 'relative to the repository root'],
    ['docs\\*.md', 'separator'],
    [`**/${'*a'.repeat(4)}*b`, 'at most 3 *'],
  ])('rejects %j', (glob, reason) => {
    // Act / Assert
    expect(validateGlob(glob)).toContain(reason);
  });

  it.each(['**/CHANGELOG.md', 'docs/*-guide*.md', 'docs/*.{md,mdx}'])(
    'accepts %s',
    (glob) => {
      // Act / Assert
      expect(validateGlob(glob)).toBeUndefined();
    },
  );
});
