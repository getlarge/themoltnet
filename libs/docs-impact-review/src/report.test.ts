import { describe, expect, it } from 'vitest';

import {
  COMMENT_TEXT_MAX,
  DOCS_IMPACT_COMMENT_MARKER,
  formatDuration,
  headingText,
  neutralize,
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
    searchTermsDropped: [],
    repairs: [],
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
      `**Docs impact: covered** · head [\`bbbbbbb\`](https://github.com/getlarge/themoltnet/commit/${'b'.repeat(40)}) · reviewed in 1s`,
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
    const blob = `https://github.com/getlarge/themoltnet/blob/${'b'.repeat(40)}`;
    expect(body).toContain('**Docs impact: updates-needed**');
    expect(body).toContain(' · 1 finding · ');
    expect(body).not.toContain('****');
    expect(body).toContain(
      `- [\`docs/reference/cli.md\`](${blob}/docs/reference/cli.md) › Flags — Document --dry-run.\n` +
        `  - Evidence: [\`apps/cli/src/flags.ts\`](${blob}/apps/cli/src/flags.ts) — adds --dry-run`,
    );
  });

  it('does not link a doc that does not exist at head yet', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        selectedDocs: [
          { path: 'docs/new.md', reasons: ['routing-map'], missing: true },
        ],
        findings: [
          {
            changeId: 'c',
            issue: 'missing',
            evidence: { path: 'src/a.ts', detail: 'd' },
            docsPath: 'docs/new.md',
            update: 'Create it.',
          },
        ],
      }),
    );

    // Assert
    expect(body).toContain('- **missing** `docs/new.md` — Create it.');
  });

  it('shortens long finding text for the comment without dropping it', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        findings: [
          {
            changeId: 'c',
            evidence: { path: 'src/a.ts', detail: 'd '.repeat(400) },
            docsPath: 'docs/a.md',
            update: 'u '.repeat(400),
          },
        ],
      }),
    );

    // Assert
    const lines = body
      .split('\n')
      .filter(
        (entry) => entry.includes('`docs/a.md`') || entry.includes('Evidence'),
      );
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.length).toBeLessThan(COMMENT_TEXT_MAX + 200);
      expect(line).toContain('…');
    }
  });

  it('shows three findings and says how many more the report holds', () => {
    // Arrange
    const finding = {
      changeId: 'c',
      evidence: { path: 'src/a.ts', detail: 'd' },
      docsPath: 'docs/a.md',
      update: 'u',
    };

    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        findings: Array.from({ length: 5 }, () => finding),
      }),
    );

    // Assert
    expect(body.match(/^- \[`docs\/a\.md`\]/gm)).toHaveLength(3);
    expect(body).toContain(' · 5 findings · ');
    expect(body).toContain('…and 2 more findings in the workflow run report.');
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

  it('says when a review ran without the repository configuration', () => {
    // Act
    const defaults = renderComment(
      report({
        outcome: 'covered',
        config: { kind: 'default', routingRules: 0 },
      }),
    );
    const override = renderComment(
      report({
        outcome: 'covered',
        config: { kind: 'file', location: 'local.json', routingRules: 3 },
      }),
    );
    const base = renderComment(
      report({
        outcome: 'covered',
        config: { kind: 'base', location: 'x', routingRules: 3 },
      }),
    );

    // Assert
    expect(defaults).toContain('reviewed with the default configuration');
    expect(override).toContain('configuration in `local.json`');
    expect(base).toContain('_Configuration: `x`._');
  });

  it.each([
    ['a long error', 'x'.repeat(70_000), /`x{999}…`/],
    ['an empty error', '', /`unknown error`/],
  ])('bounds %s in the comment', (_label, error, expected) => {
    // Act
    const body = renderComment(
      report({ status: 'failed', outcome: undefined, error }),
    );

    // Assert
    expect(body).toMatch(expected);
    expect(body.length).toBeLessThan(2_000);
  });

  it('keeps an error message inside its code span', () => {
    // Act
    const body = renderComment(
      report({
        status: 'failed',
        outcome: undefined,
        headRevision: '',
        error: 'bad `key`\n# heading [link](https://x)',
      }),
    );

    // Assert
    expect(body).toContain(
      '``bad `key` # heading [link](https://x)``. No judgment was made.',
    );
    expect(body).toContain('head unknown');
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

describe('neutralize', () => {
  it('breaks mentions and escapes markup in model-written text', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        findings: [
          {
            changeId: 'c',
            evidence: { path: 'src/a.ts', detail: 'ping @octocat <img src=x>' },
            docsPath: 'docs/a.md',
            section: '## Use @team',
            update: 'Tell @getlarge/maintainers',
          },
        ],
      }),
    );

    // Assert
    expect(body).not.toMatch(/@(octocat|team|getlarge)/);
    expect(body).toContain('@\u200boctocat');
    expect(body).toContain('&lt;img src=x&gt;');
    expect(body).not.toContain('<img');
  });

  it('keeps only the text of Markdown links and images', () => {
    // Act / Assert
    expect(neutralize('see [the docs](https://evil.example) ![x](y.png)')).toBe(
      'see the docs x',
    );
  });

  it('keeps crafted paths inside their code span and link target', () => {
    // Act
    const body = renderComment(
      report({
        outcome: 'updates-needed',
        findings: [
          {
            changeId: 'c',
            evidence: { path: 'src/a`](https://x) b.ts', detail: 'd' },
            docsPath: 'docs/a.md',
            update: 'u',
          },
        ],
        gaps: [{ scope: 'x` **bold**', reason: 'r' }],
      }),
    );

    // Assert
    expect(body).toContain('[``src/a`](https://x) b.ts``]');
    expect(body).toContain('/src/a%60%5D%28https%3A//x%29%20b.ts)');
    expect(body).toContain('- ``x` **bold**``: r');
  });

  it('leaves email-like text and plain text readable', () => {
    // Act / Assert
    expect(neutralize('a @ b')).toBe('a @ b');
    expect(neutralize('plain text')).toBe('plain text');
  });
});

describe('headingText', () => {
  it.each([
    ['## What it tried', 'What it tried'],
    ['### 6. Verify the result', '6. Verify the result'],
    ['Plain section', 'Plain section'],
  ])('renders %j as %j', (section, expected) => {
    // Act / Assert
    expect(headingText(section)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [300, '1s'],
    [48_000, '48s'],
    [168_400, '2m 48s'],
  ])('formats %d ms as %s', (ms, expected) => {
    // Act / Assert
    expect(formatDuration(ms)).toBe(expected);
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
      queuedAt: null,
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
