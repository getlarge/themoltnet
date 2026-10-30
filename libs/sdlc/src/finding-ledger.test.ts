import { describe, expect, it } from 'vitest';

import type { Finding } from './contracts.js';
import { retainFindings } from './finding-ledger.js';

const revision = {
  base: 'base',
  head: 'head',
  policyDigest: 'policy',
  briefDigest: 'brief',
};
const open: Finding = {
  id: 'problem',
  origin: 'introduced',
  disposition: 'open',
};
const fixed: Finding = {
  ...open,
  disposition: 'fixed',
  verification: { revision, evidence: 'accepted-verification' },
};
describe('finding retention', () => {
  it('retains omitted problems', () => {
    expect(retainFindings([open], { current: revision, reviews: {} })).toEqual([
      open,
    ]);
  });
  it('accepts explicit current adjudication', () => {
    expect(
      retainFindings([open], {
        current: revision,
        reviews: { tests: { revision, status: 'passed', findings: [fixed] } },
      }),
    ).toEqual([fixed]);
  });
  it('does not let a stale report settle current problems', () => {
    expect(
      retainFindings([open], {
        current: revision,
        reviews: {
          tests: {
            revision: { ...revision, head: 'old' },
            status: 'passed',
            findings: [fixed],
          },
        },
      }),
    ).toEqual([open]);
  });
  it('keeps contradictory dispositions open regardless of lane order', () => {
    for (const findings of [
      [open, fixed],
      [fixed, open],
    ]) {
      expect(
        retainFindings([], {
          current: revision,
          reviews: Object.fromEntries(
            findings.map((finding, i) => [
              String(i),
              { revision, status: 'passed', findings: [finding] },
            ]),
          ),
        }),
      ).toEqual([{ id: 'problem', origin: 'unknown', disposition: 'open' }]);
    }
  });
});
