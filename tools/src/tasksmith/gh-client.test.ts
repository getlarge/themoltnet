import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileTextMock } = vi.hoisted(() => ({
  execFileTextMock: vi.fn(),
}));

vi.mock('@moltnet/context-evals/process', () => ({
  execFileText: execFileTextMock,
}));

import { filterCandidatePrs, gitDiff, parseLinkedIssue } from './gh-client.js';

describe('parseLinkedIssue', () => {
  beforeEach(() => {
    execFileTextMock.mockReset();
  });

  it('extracts issue number from "Fixes #123"', () => {
    expect(parseLinkedIssue('Some text\nFixes #42\nMore text')).toBe(42);
  });

  it('extracts from "Closes #N"', () => {
    expect(parseLinkedIssue('Closes #7')).toBe(7);
  });

  it('extracts from "Resolves #N"', () => {
    expect(parseLinkedIssue('Resolves #100')).toBe(100);
  });

  it('returns null when no link', () => {
    expect(parseLinkedIssue('No issue reference here')).toBeNull();
  });
});

describe('filterCandidatePrs', () => {
  const basePr = {
    number: 1,
    title: 'feat: add feature',
    body: '',
    baseRefName: 'main',
    headRefOid: 'abc123',
    mergeCommit: { oid: 'def456' },
    labels: [],
    closedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts PR with test file changes', () => {
    const files = [
      { path: 'libs/auth/src/auth.ts' },
      { path: 'libs/auth/src/auth.test.ts' },
    ];
    const result = filterCandidatePrs([{ ...basePr, files }]);
    expect(result).toHaveLength(1);
  });

  it('rejects docs-only PR', () => {
    const files = [{ path: 'docs/README.md' }, { path: 'docs/guide.md' }];
    const result = filterCandidatePrs([{ ...basePr, files }]);
    expect(result).toHaveLength(0);
  });

  it('rejects release PR', () => {
    const files = [{ path: 'src/index.test.ts' }];
    const result = filterCandidatePrs([
      { ...basePr, title: 'chore: release v1.0.0', files },
    ]);
    expect(result).toHaveLength(0);
  });

  it('rejects PR without mergeCommit', () => {
    const files = [{ path: 'src/index.test.ts' }];
    const result = filterCandidatePrs([
      { ...basePr, mergeCommit: null, files },
    ]);
    expect(result).toHaveLength(0);
  });

  it('rejects PR without any test files', () => {
    const files = [{ path: 'src/index.ts' }, { path: 'src/utils.ts' }];
    const result = filterCandidatePrs([{ ...basePr, files }]);
    expect(result).toHaveLength(0);
  });
});

describe('gitDiff', () => {
  beforeEach(() => {
    execFileTextMock.mockReset();
  });

  it('runs file-scoped diffs from the repo root', async () => {
    execFileTextMock
      .mockResolvedValueOnce('/repo/root\n')
      .mockResolvedValueOnce('diff output');

    const out = await gitDiff(
      'base123',
      'head456',
      'apps/rest-api/foo.test.ts',
    );

    expect(out).toBe('diff output');
    expect(execFileTextMock).toHaveBeenNthCalledWith(1, 'git', [
      'rev-parse',
      '--show-toplevel',
    ]);
    expect(execFileTextMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', 'base123', 'head456', '--', 'apps/rest-api/foo.test.ts'],
      { cwd: '/repo/root' },
    );
  });
});
