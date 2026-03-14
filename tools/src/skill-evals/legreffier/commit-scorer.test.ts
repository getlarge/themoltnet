import { describe, expect, it } from 'vitest';

import { scoreCommitTiers } from './commit-scorer.js';

describe('scoreCommitTiers', () => {
  it('returns 1.0 when all tiers pass (Group 1)', () => {
    const result = scoreCommitTiers({
      commitMessages: [
        'fix(diary-service): fix pagination offset\n\nMoltNet-Diary: abc-123',
      ],
      diaryEntries: [
        {
          id: 'abc-123',
          entryType: 'procedural',
          tags: [
            'accountable-commit',
            'risk:medium',
            'branch:eval',
            'scope:diary',
          ],
          content:
            '<moltnet-signed><content>rationale</content><metadata>signer: ABCD\noperator: edouard\ntool: claude\nrisk-level: medium\nfiles-changed: 2\nrefs: libs/diary-service/src/pagination.ts\ntimestamp: 2026-03-13T00:00:00Z\nbranch: eval\nscope: scope:diary</metadata><signature>base64sig==</signature></moltnet-signed>',
          signatureValid: true,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBeCloseTo(1.0);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(true);
    expect(result.tiers.niceToHave).toBe(true);
  });

  it('returns 0.6 when only must-have passes', () => {
    const result = scoreCommitTiers({
      commitMessages: ['fix(diary): fix pagination\n\nMoltNet-Diary: abc-123'],
      diaryEntries: [
        {
          id: 'abc-123',
          entryType: 'semantic', // wrong type
          tags: ['accountable-commit'], // missing risk, branch
          content: 'no metadata block',
          signatureValid: false,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBe(0.6);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(false);
    expect(result.tiers.niceToHave).toBe(false);
  });

  it('returns 0 when must-have fails (no diary entry)', () => {
    const result = scoreCommitTiers({
      commitMessages: ['fix(diary): fix pagination'],
      diaryEntries: [],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBe(0);
    expect(result.tiers.mustHave).toBe(false);
  });
});
