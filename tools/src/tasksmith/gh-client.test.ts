import { describe, expect, it } from 'vitest';

import { filterCandidatePrs, parseLinkedIssue } from './gh-client.js';

describe('parseLinkedIssue', () => {
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
