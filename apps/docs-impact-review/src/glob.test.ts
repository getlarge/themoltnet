import { describe, expect, it } from 'vitest';

import { matchesAny, matchesGlob } from './glob.js';

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
