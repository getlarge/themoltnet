import { describe, expect, it } from 'vitest';

import { matchesAny, matchesGlob, validateGlob } from './glob.js';

describe('matchesGlob', () => {
  it.each([
    ['**/CHANGELOG.md', 'CHANGELOG.md', true],
    ['**/CHANGELOG.md', 'docs/CHANGELOG.md', true],
    ['**/CHANGELOG.md', '.github/CHANGELOG.md', true],
    ['**/skills/**', 'x/.claude/skills/a/SKILL.md', true],
    ['**/skills/**', 'skills/a.md', true],
    ['.agents/**', '.agents/skills/a.md', true],
    ['.agents/**', 'docs/.agents.md', false],
    ['vendor', 'vendor/a.md', true],
    ['vendor', 'vendor', true],
    ['vendor', 'vendored/a.md', false],
    ['docs/*.md', 'docs/a.md', true],
    ['docs/*.md', 'docs/nested/a.md', false],
    ['docs/?.md', 'docs/a.md', true],
    ['apps/cli/**', 'apps/cli/src/flags.ts', true],
    ['apps/cli/**', 'apps/cli-e2e/a.ts', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/README.md', false],
    ['docs/a+b.md', 'docs/a+b.md', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    // Act / Assert
    expect(matchesGlob(path, glob)).toBe(expected);
  });
});

describe('matchesAny', () => {
  it('matches when any glob matches and never on an empty list', () => {
    // Act / Assert
    expect(matchesAny('vendor/a.md', ['docs/**', 'vendor'])).toBe(true);
    expect(matchesAny('vendor/a.md', [])).toBe(false);
  });
});

describe('matching cost', () => {
  it('stays fast on a pattern built to backtrack against a long path', () => {
    // Arrange
    const glob = `**/${'*a'.repeat(12)}*b`;
    const path = `${'x/'.repeat(200)}${'a'.repeat(400)}`;
    const started = performance.now();

    // Act
    const matched = matchesGlob(path, glob);

    // Assert
    expect(matched).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('matching depth', () => {
  it('matches a path thousands of segments deep without recursion', () => {
    // Arrange
    const deep = `${'a/'.repeat(8_000)}c`;

    // Act / Assert
    expect(matchesGlob(deep, '**/c')).toBe(true);
    expect(matchesGlob(`${'a/'.repeat(8_000)}b`, '**/c')).toBe(false);
  });

  it('keeps ** inside a segment within that segment', () => {
    // Act / Assert
    expect(matchesGlob('docs/foo-bar.md', 'docs/foo**')).toBe(true);
    expect(matchesGlob('docs/foo/bar.md', 'docs/foo**')).toBe(false);
  });
});

describe('validateGlob', () => {
  it.each([
    ['docs/[ab]*.md', 'character classes'],
    ['docs/*.{md,mdx}', 'brace alternatives'],
    ['docs\\*.md', 'escapes'],
    ['!vendor/**', 'negation'],
    ['/', 'empty'],
    ['', 'empty'],
  ])('rejects %j', (glob, reason) => {
    // Act / Assert
    expect(validateGlob(glob)).toContain(reason);
  });

  it('accepts ordinary patterns, including leading and trailing slashes', () => {
    // Act / Assert
    expect(validateGlob('/vendor/')).toBeUndefined();
    expect(matchesGlob('vendor/a.md', '/vendor/')).toBe(true);
  });
});
