import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadReviewConfig, REVIEW_CONFIG_PATH } from './review-config.js';
import { reviewEach } from './review-each.js';
import { createTestRepo, type TestRepo } from './test-repo.js';
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

describe('reviewEach failures', () => {
  it('names the phase that failed', async () => {
    // Arrange
    const logs: string[] = [];

    // Act
    const [report] = await reviewEach(
      'o/r',
      [4],
      (target) => {
        target.phase = 'fetch';
        return Promise.reject(new Error('git fetch timed out after 1 ms'));
      },
      () => {},
      (message) => logs.push(message),
    );

    // Assert
    expect(report.error).toBe(
      'failed during fetch: git fetch timed out after 1 ms',
    );
    expect(logs).toEqual([
      '[pr 4] failed during fetch: git fetch timed out after 1 ms',
    ]);
  });

  it('keeps going when writing a report fails', async () => {
    // Arrange
    const logs: string[] = [];

    // Act
    const reports = await reviewEach(
      'o/r',
      [1, 2],
      (target) => Promise.resolve(completed(target.pr)),
      (report) => {
        if (report.pr === 1) throw new Error('EACCES: out/pr-1.json');
      },
      (message) => logs.push(message),
    );

    // Assert
    expect(reports.map((report) => report.pr)).toEqual([1, 2]);
    expect(logs).toEqual([
      '[pr 1] could not write the report: EACCES: out/pr-1.json',
    ]);
  });
});

describe('reviewEach with base configurations', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it("reads each pull request's own base config, failing only the bad one", async () => {
    // Arrange: one base with a valid config, a later one with a broken one.
    const good = repo.commit({
      [REVIEW_CONFIG_PATH]: JSON.stringify({ version: 1, instructions: 'A' }),
    });
    const bad = repo.commit({
      [REVIEW_CONFIG_PATH]: JSON.stringify({ version: 1, unknown: true }),
    });
    const bases: Record<number, string> = { 1: good, 2: bad };
    const seen: Array<string | undefined> = [];

    // Act
    const reports = await reviewEach(
      'o/r',
      [1, 2],
      (target) => {
        target.baseRevision = bases[target.pr];
        target.headRevision = HEAD;
        target.phase = 'config';
        const { config, source } = loadReviewConfig(
          repo.git,
          target.baseRevision,
        );
        target.configSource = source;
        seen.push(config.instructions);
        return Promise.resolve({ ...completed(target.pr), config: source });
      },
      () => {},
      () => {},
    );

    // Assert
    expect(seen).toEqual(['A']);
    expect(reports[0]).toMatchObject({
      status: 'completed',
      config: { kind: 'base', location: `${REVIEW_CONFIG_PATH}@${good}` },
    });
    expect(reports[1]).toMatchObject({
      status: 'failed',
      baseRevision: bad,
      config: { kind: 'base', location: `${REVIEW_CONFIG_PATH}@${bad}` },
    });
    expect(reports[1].error).toContain('failed during config: invalid');
  });
});
