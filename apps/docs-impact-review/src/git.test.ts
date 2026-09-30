import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeGitFailure, existsAt, GitCommandError } from './git.js';
import { createTestRepo, type TestRepo } from './test-repo.js';

describe('existsAt', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('answers for the given revision, not the working tree', () => {
    // Arrange
    const before = repo.commit({ 'docs/a.md': '# a' });
    const after = repo.commit({ 'docs/a.md': null, 'docs/b.md': '# b' });

    // Act / Assert
    expect(existsAt(repo.git, before, 'docs/a.md')).toBe(true);
    expect(existsAt(repo.git, after, 'docs/a.md')).toBe(false);
    expect(existsAt(repo.git, after, 'docs/b.md')).toBe(true);
    expect(existsAt(repo.git, 'f'.repeat(40), 'docs/b.md')).toBe(false);
  });
});

describe('git failures', () => {
  it('rethrows a timeout instead of reporting the page missing', () => {
    // Arrange
    const git = () => {
      throw describeGitFailure(
        ['cat-file'],
        Object.assign(new Error('spawnSync git ETIMEDOUT'), {
          code: 'ETIMEDOUT',
        }),
        300_000,
      );
    };

    // Act / Assert
    expect(() => existsAt(git, 'a'.repeat(40), 'docs/a.md')).toThrow(
      'git cat-file timed out after 300000 ms',
    );
  });

  it.each([
    [
      'an exit status',
      { status: 128, signal: null, stderr: 'fatal: bad object\n' },
      'git fetch exited with 128: fatal: bad object',
    ],
    [
      'an output limit',
      { code: 'ENOBUFS' },
      'git fetch wrote more than 67108864 bytes of output',
    ],
    [
      'a signal',
      { status: null, signal: 'SIGKILL' },
      'git fetch failed (SIGKILL)',
    ],
  ])('names the command and cause of %s', (_label, fields, message) => {
    // Act
    const error = describeGitFailure(
      ['fetch', 'origin'],
      Object.assign(new Error('boom'), fields),
      1_000,
    );

    // Assert
    expect(error.message).toContain(message);
    expect(error instanceof GitCommandError).toBe(_label === 'an exit status');
  });
});
