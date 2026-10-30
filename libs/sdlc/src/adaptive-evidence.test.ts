import type { AdaptiveReport } from '@moltnet/adaptive-review';
import { describe, expect, it } from 'vitest';

import { adaptiveReviewEvidence } from './adaptive-evidence.js';

function fixture() {
  const revision = {
    base: 'base',
    head: 'head',
    policyDigest: 'sdlc-policy',
    briefDigest: 'brief',
  };
  const binding = {
    revision,
    repository: 'owner/repo',
    pr: 1,
    correlationId: 'case',
    reviewPolicyDigest: 'review-policy',
    runtimeSha: 'runtime',
  };
  const report: AdaptiveReport = {
    version: 1,
    mode: 'active',
    repo: 'owner/repo',
    pr: 1,
    base: 'base',
    head: 'head',
    correlationId: 'case',
    policyDigest: 'review-policy',
    runtimeSha: 'runtime',
    referenceDigests: {},
    packetCount: 1,
    durationMs: 1,
    taskIds: ['review'],
    gaps: [],
    routing: {
      classifierFailed: false,
      scores: { 'code-complexity': 1, 'review-effort': 1 },
      routes: [],
    },
    results: [
      {
        lane: 'tests',
        status: 'clear',
        summary: '',
        taskIds: ['review'],
        findings: [],
      },
    ],
  };
  return { binding, report };
}
describe('adaptive evidence', () => {
  it('binds the review policy separately from the enclosing SDLC policy', () => {
    const { report, binding } = fixture();
    expect(adaptiveReviewEvidence(report, binding)?.tests).toEqual({
      revision: binding.revision,
      status: 'passed',
      findings: [],
    });
  });
  it.each([
    'base',
    'head',
    'policyDigest',
    'runtimeSha',
    'correlationId',
  ] as const)('does not relabel stale %s evidence as current', (key) => {
    const { report, binding } = fixture();
    report[key] = 'stale';
    expect(adaptiveReviewEvidence(report, binding)).toBeUndefined();
  });
  it('retains unanchored findings without exposing their text', () => {
    const { report, binding } = fixture();
    report.results[0].findings = [
      { path: 'x.ts', concern: 'Private detail', problemId: 'missing-guard' },
    ];
    const result = adaptiveReviewEvidence(report, binding);
    expect(result?.tests.findings).toEqual([
      {
        id: result?.tests.findings[0].id,
        origin: 'unknown',
        disposition: 'open',
      },
    ]);
    expect(result?.tests.findings[0].id).toMatch(/^v2:/);
    expect(JSON.stringify(result)).not.toContain('Private detail');
  });
  it('keeps security concerns blocking even when public findings are empty', () => {
    const { report, binding } = fixture();
    report.results[0].lane = 'security';
    report.results[0].status = 'concern';
    expect(adaptiveReviewEvidence(report, binding)?.security.status).toBe(
      'failed',
    );
  });
  it('retains opaque private finding identities for later verification', () => {
    const { report, binding } = fixture();
    report.results[0].lane = 'security';
    report.results[0].privateFindingIds = ['opaque-problem'];
    expect(adaptiveReviewEvidence(report, binding)?.security.findings).toEqual([
      { id: 'opaque-problem', origin: 'unknown', disposition: 'open' },
    ]);
  });
  it.each(['unclear', 'failed'] as const)(
    'does not treat %s coverage as passed',
    (status) => {
      const { report, binding } = fixture();
      report.results[0].status = status;
      expect(adaptiveReviewEvidence(report, binding)?.tests.status).toBe(
        'incomplete',
      );
    },
  );
  it('leaves screened lanes absent so a full audit can supply their coverage', () => {
    const { report, binding } = fixture();
    report.results[0].status = 'screened';
    expect(adaptiveReviewEvidence(report, binding)).toEqual({});
  });
  it('blocks a report with global coverage gaps', () => {
    const { report, binding } = fixture();
    report.gaps = ['missing diff'];
    expect(adaptiveReviewEvidence(report, binding)?.tests.status).toBe(
      'incomplete',
    );
  });
});
