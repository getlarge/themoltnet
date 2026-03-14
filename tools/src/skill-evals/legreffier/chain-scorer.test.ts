import { describe, expect, it } from 'vitest';

import { scoreChainTiers } from './chain-scorer.js';

describe('scoreChainTiers', () => {
  const makeEntry = (
    id: string,
    overrides?: Partial<{
      entryType: string;
      tags: string[];
      content: string;
      signatureValid: boolean;
    }>,
  ) => ({
    id,
    entryType: overrides?.entryType ?? 'procedural',
    tags: overrides?.tags ?? [
      'accountable-commit',
      'risk:low',
      'branch:eval',
      'scope:crypto',
    ],
    content:
      overrides?.content ??
      '<moltnet-signed><content>rationale</content><metadata>signer: ABCD\noperator: edouard\ntool: claude\nrisk-level: low\nrefs: libs/crypto\ntimestamp: 2026-03-13T00:00:00Z</metadata></moltnet-signed>',
    signatureValid: overrides?.signatureValid ?? true,
  });

  it('returns 1.0 when all chain tiers pass', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(db): stabilize ordering\n\nMoltNet-Diary: abc\nTask-Group: ordering-fix\nTask-Family: bugfix',
        'test(db): add ordering assertions\n\nMoltNet-Diary: def\nTask-Group: ordering-fix\nTask-Completes: true',
      ],
      diaryEntries: [makeEntry('abc'), makeEntry('def')],
      expected: {
        commitType: 'fix',
        riskLevel: 'low',
        scopes: ['scope:crypto'],
        isChain: true,
        expectedCommitCount: 2,
      },
    });

    expect(result.total).toBeCloseTo(1.0);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(true);
    expect(result.tiers.niceToHave).toBe(true);
  });

  it('returns 0.6 when only must-have passes', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(db): stabilize ordering\n\nMoltNet-Diary: abc',
        'test(db): add assertions\n\nMoltNet-Diary: def',
      ],
      diaryEntries: [
        makeEntry('abc', { tags: ['accountable-commit'] }),
        makeEntry('def', { tags: ['accountable-commit'] }),
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'low',
        scopes: ['scope:crypto'],
        isChain: true,
        expectedCommitCount: 2,
      },
    });

    expect(result.total).toBe(0.6);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(false);
  });

  it('returns 0 when must-have fails (missing trailers)', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(db): stabilize ordering',
        'test(db): add assertions',
      ],
      diaryEntries: [],
      expected: {
        commitType: 'fix',
        riskLevel: 'low',
        scopes: ['scope:crypto'],
        isChain: true,
        expectedCommitCount: 2,
      },
    });

    expect(result.total).toBe(0);
    expect(result.tiers.mustHave).toBe(false);
  });
});
