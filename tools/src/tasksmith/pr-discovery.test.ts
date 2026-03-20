import { describe, expect, it } from 'vitest';

import { buildPrCandidate, loadHarvestState } from './pr-discovery.js';

describe('buildPrCandidate', () => {
  it('maps raw GH PR data to PrCandidate', () => {
    const raw = {
      number: 408,
      title: 'fix(auth): validate JWT expiry',
      body: 'Fixes #42\nJWT tokens were not checked for expiry.',
      baseRefName: 'main',
      headRefOid: 'abc123',
      mergeCommitOid: 'def456',
      labels: ['bug'],
      closedAt: '2026-03-01T00:00:00Z',
      files: [
        { path: 'libs/auth/src/jwt.ts' },
        { path: 'libs/auth/src/jwt.test.ts' },
      ],
    };
    const candidate = buildPrCandidate(raw, 'base111', 'Issue body text');
    expect(candidate.number).toBe(408);
    expect(candidate.fixtureRef).toBe('base111');
    expect(candidate.goldFixRef).toBe('def456');
    expect(candidate.changedTestFiles).toEqual(['libs/auth/src/jwt.test.ts']);
    expect(candidate.linkedIssueBody).toBe('Issue body text');
  });
});

describe('loadHarvestState', () => {
  it('returns empty state when file does not exist', async () => {
    const state = await loadHarvestState('/nonexistent/path');
    expect(state.processed_prs).toEqual([]);
  });
});
