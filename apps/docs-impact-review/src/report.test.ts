import { describe, expect, it } from 'vitest';

import {
  DOCS_IMPACT_COMMENT_MARKER,
  percentile,
  renderComment,
  summarizeCorpus,
} from './report.js';
import type { DocsImpactReport } from './types.js';

function report(overrides: Partial<DocsImpactReport> = {}): DocsImpactReport {
  return {
    version: 1,
    repo: 'getlarge/themoltnet',
    pr: 7,
    baseRevision: 'a'.repeat(40),
    headRevision: 'b'.repeat(40),
    status: 'completed',
    outcome: 'not-needed',
    findings: [],
    gaps: [],
    manifest: {
      files: 1,
      byCategory: { source: 1, docs: 0, test: 0, generated: 0, binary: 0 },
      diffBytes: 10,
    },
    selectedDocs: [],
    contractChanges: [],
    timings: { ingestMs: 10, retrievalMs: 5, stages: {}, totalMs: 1_000 },
    ...overrides,
  };
}

describe('renderComment', () => {
  it('keeps a clean result to one line after the marker', () => {
    // Act
    const body = renderComment(report({ outcome: 'covered' }));

    // Assert
    expect(body.split('\n')).toEqual([
      DOCS_IMPACT_COMMENT_MARKER,
      `**Docs impact: covered** · head \`${'b'.repeat(40)}\``,
    ]);
  });

  it('lists findings with evidence and the doc to update', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        findings: [
          {
            changeId: 'dry-run-flag',
            evidence: {
              path: 'apps/cli/src/flags.ts',
              detail: 'adds --dry-run',
            },
            docsPath: 'docs/reference/cli.md',
            section: '## Flags',
            update: 'Document --dry-run.',
          },
        ],
      }),
    );

    // Assert
    expect(body).toContain('**Docs impact: updates-needed**');
    expect(body).toContain(
      '- `docs/reference/cli.md` › ## Flags — Document --dry-run. (evidence: `apps/cli/src/flags.ts`: adds --dry-run)',
    );
  });

  it('names uncovered scope for an incomplete result', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'incomplete',
        gaps: [{ scope: 'src/big.ts', reason: 'omitted' }],
      }),
    );

    // Assert
    expect(body).toContain('- `src/big.ts`: omitted');
  });

  it('never renders a failed run as a clean result', () => {
    // Act
    const body = renderComment(
      report({ status: 'failed', outcome: undefined, error: 'no daemon' }),
    );

    // Assert
    expect(body).toContain('**Docs impact: not reviewed**');
    expect(body).toContain('no daemon');
  });
});

describe('percentile', () => {
  it('uses nearest-rank', () => {
    // Act / Assert
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });
});

describe('summarizeCorpus', () => {
  it('aggregates outcomes and latency percentiles per phase', () => {
    // Arrange
    const stage = (setupMs: number) => ({
      taskId: 't',
      createdAt: '',
      claimedAt: null,
      startedAt: null,
      executeStartAt: null,
      firstModelEventAt: null,
      completedAt: null,
      queueMs: 100,
      openMs: 50,
      setupMs,
      firstModelEventMs: null,
      modelMs: 900,
      executionMs: 1_000,
      observedMs: 1_300,
      toolCalls: 0,
      inputTokens: 10,
      outputTokens: 5,
      model: 'glm',
    });
    const reports = [
      report({
        timings: {
          ingestMs: 1,
          retrievalMs: 1,
          stages: { extract: stage(8_000) },
          totalMs: 10_000,
        },
      }),
      report({
        status: 'failed',
        outcome: undefined,
        timings: {
          ingestMs: 1,
          retrievalMs: 1,
          stages: { extract: stage(20_000) },
          totalMs: 30_000,
        },
      }),
    ];

    // Act
    const summary = summarizeCorpus(reports);

    // Assert
    expect(summary.outcomes).toEqual({ 'not-needed': 1, failed: 1 });
    expect(summary.latencyMs.total).toEqual({ p50: 10_000, p95: 30_000 });
    expect(summary.latencyMs['extract.setup']).toEqual({
      p50: 8_000,
      p95: 20_000,
    });
  });
});
