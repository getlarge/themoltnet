import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { existsAt } from './git.js';
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
