import { describe, expect, it } from 'vitest';

import { parseLabels, scoreReports } from './score.js';
import type { DocsFinding, DocsImpactReport } from './types.js';

function report(
  pr: number,
  findings: DocsFinding[],
  outcome: DocsImpactReport['outcome'] = 'updates-needed',
): DocsImpactReport {
  return {
    version: 1,
    repo: 'getlarge/themoltnet',
    pr,
    baseRevision: 'a'.repeat(40),
    headRevision: 'b'.repeat(40),
    status: 'completed',
    outcome,
    findings,
    gaps: [],
    searchTermsDropped: [],
    repairs: [],
    manifest: {
      files: 1,
      byCategory: { source: 1, docs: 0, test: 0, generated: 0, binary: 0 },
      diffBytes: 1,
    },
    selectedDocs: [],
    contractChanges: [],
    timings: { ingestMs: 0, retrievalMs: 0, stages: {}, totalMs: 0 },
  };
}

function finding(overrides: Partial<DocsFinding>): DocsFinding {
  return {
    changeId: 'c',
    evidence: { path: 'src/a.ts', detail: 'adds RATE_LIMIT_TOKEN_IP' },
    docsPath: 'docs/a.md',
    update: 'Document it.',
    ...overrides,
  };
}

const labels = parseLabels({
  version: 1,
  prs: {
    '1': {
      expected: [
        { docsPath: 'docs/a.md', issue: 'unnecessary', note: 'n' },
        { mentions: 'rate_limit', note: 'n' },
      ],
    },
    '2': { forbidden: [{ docsPath: 'docs/stale.md', note: 'n' }] },
  },
});

describe('scoreReports', () => {
  it('scores recall, precision and issue accuracy separately', () => {
    // Arrange
    const reports = [
      report(1, [finding({ issue: 'missing' })]),
      report(2, [
        finding({ docsPath: 'docs/stale.md' }),
        finding({
          docsPath: 'docs/other.md',
          evidence: { path: 'x', detail: 'y' },
        }),
      ]),
    ];

    // Act
    const score = scoreReports(reports, labels);

    // Assert
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(0.5);
    expect(score.issueAccuracy).toBe(0);
    expect(score.prs[0]).toMatchObject({ found: 2, issueMismatches: 1 });
    expect(score.prs[1]).toMatchObject({
      forbiddenHits: 1,
      unlabeledFindings: 1,
    });
  });

  it('accepts any of several acceptable doc locations', () => {
    // Arrange
    const alternatives = parseLabels({
      version: 1,
      prs: {
        '3': {
          expected: [
            { docsPaths: ['docs/run.md', 'apps/x/README.md'], note: 'n' },
          ],
        },
      },
    });

    // Act
    const score = scoreReports(
      [report(3, [finding({ docsPath: 'apps/x/README.md' })])],
      alternatives,
    );

    // Assert
    expect(score.recall).toBe(1);
  });

  it('counts expected findings of a failed review as missed', () => {
    // Act
    const score = scoreReports([report(1, [], undefined)], labels);

    // Assert
    expect(score.recall).toBe(0);
    expect(score.precision).toBeNull();
  });

  it('rejects labels without a note', () => {
    // Act / Assert
    expect(() =>
      parseLabels({
        version: 1,
        prs: { '1': { expected: [{ docsPath: 'x' }] } },
      }),
    ).toThrow(/invalid labels/);
  });
});
