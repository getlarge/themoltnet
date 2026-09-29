import { describe, expect, it } from 'vitest';

import { reviewEach } from './review-each.js';
import type { DocsImpactReport } from './types.js';

const HEAD = 'b'.repeat(40);

function completed(pr: number): DocsImpactReport {
  return {
    version: 1,
    repo: 'o/r',
    pr,
    baseRevision: 'a'.repeat(40),
    headRevision: HEAD,
    status: 'completed',
    outcome: 'covered',
    findings: [],
    gaps: [],
    searchTermsDropped: [],
    repairs: [],
    manifest: { files: 0, byCategory: {} as never, diffBytes: 0 },
    selectedDocs: [],
    contractChanges: [],
    timings: { ingestMs: 0, retrievalMs: 0, stages: {}, totalMs: 0 },
  };
}

describe('reviewEach', () => {
  it('reports a failing pull request and still reviews the next one', async () => {
    // Arrange
    const written: DocsImpactReport[] = [];

    // Act
    const reports = await reviewEach(
      'o/r',
      [1, 2, 3],
      (target) => {
        if (target.pr === 1) {
          return Promise.reject(new Error('gh: not found'));
        }
        if (target.pr === 2) {
          target.headRevision = HEAD;
          target.configSource = { kind: 'base', location: 'cfg@x' };
          return Promise.reject(new Error('invalid cfg@x'));
        }
        return Promise.resolve(completed(target.pr));
      },
      (report) => written.push(report),
    );

    // Assert
    expect(reports.map((report) => [report.pr, report.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'completed'],
    ]);
    expect(reports[0]).toMatchObject({
      error: 'gh: not found',
      headRevision: '',
    });
    expect(reports[0].config).toBeUndefined();
    expect(reports[1]).toMatchObject({
      error: 'invalid cfg@x',
      headRevision: HEAD,
      config: { kind: 'base', location: 'cfg@x' },
    });
    expect(written).toEqual(reports);
  });

  it('skips dry runs, which produce no report', async () => {
    // Act
    const reports = await reviewEach(
      'o/r',
      [1],
      () => Promise.resolve(undefined),
      () => {
        throw new Error('no report to write');
      },
    );

    // Assert
    expect(reports).toEqual([]);
  });
});
