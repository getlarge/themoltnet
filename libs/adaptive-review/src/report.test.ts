import { expect, it } from 'vitest';

import { LANES } from './core.js';
import { renderAdaptiveComment } from './report.js';
import type { AdaptiveReport } from './workflow.js';

it('labels screening honestly and neutralizes model-authored text', () => {
  const report: AdaptiveReport = {
    version: 1,
    mode: 'active',
    repo: 'getlarge/themoltnet',
    pr: 42,
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    correlationId: 'id',
    policyDigest: 'd'.repeat(64),
    referenceDigests: {},
    runtimeSha: 'c'.repeat(40),
    packetCount: 1,
    taskIds: [],
    gaps: ['[gap](bad) @team #456 <script>'],
    durationMs: 100,
    routing: {
      classifierFailed: false,
      scores: { 'code-complexity': 1, 'review-effort': 2 },
      routes: LANES.map((lane) => ({
        lane,
        probability: 0.01,
        run: false,
        reason: 'screened',
      })),
    },
    results: LANES.map((lane) => ({
      lane,
      status:
        lane === 'tests'
          ? 'concern'
          : lane === 'conventions'
            ? 'unclear'
            : 'screened',
      summary:
        lane === 'tests'
          ? '@owner [click](bad) <script>'
          : lane === 'conventions'
            ? '@reviewer [unclear](bad)'
            : 'screened',
      taskIds: [],
      ...(lane === 'conventions'
        ? { unclear: ['`docs/x.md`: @owner [hunk](bad) not judged'] }
        : {}),
      findings:
        lane === 'tests'
          ? [
              {
                path: '[owned].ts',
                line: 7,
                concern: '#123 @maintainer <b>',
              },
            ]
          : [],
    })),
  };
  const comment = renderAdaptiveComment(
    report,
    'https://github.com/getlarge/themoltnet/actions/runs/1',
  );
  expect(comment).toContain('screened, not verified');
  expect(comment).toContain('@\u200bowner \\[click\\](bad) &lt;script&gt;');
  expect(comment).toContain(
    '\\[owned\\].ts:7: #\u200b123 @\u200bmaintainer &lt;b&gt;',
  );
  expect(comment).toContain(
    '\\[gap\\](bad) @\u200bteam #\u200b456 &lt;script&gt;',
  );
  expect(comment).toContain('conventions: @\u200breviewer \\[unclear\\](bad)');
  expect(comment).toContain(
    'conventions: `docs/x.md`: @\u200bowner \\[hunk\\](bad) not judged',
  );
  expect(comment).not.toContain('@owner');
  expect(comment).not.toContain('[click](bad)');
  expect(comment).not.toContain('<script>');
});

it('labels a focused citation from the old side of the diff', () => {
  const report: AdaptiveReport = {
    version: 1,
    mode: 'active',
    repo: 'getlarge/themoltnet',
    pr: 42,
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    correlationId: 'id',
    policyDigest: 'd'.repeat(64),
    referenceDigests: {},
    runtimeSha: 'c'.repeat(40),
    packetCount: 1,
    taskIds: [],
    gaps: [],
    durationMs: 100,
    routing: {
      classifierFailed: false,
      scores: { 'code-complexity': null, 'review-effort': null },
      routes: [
        { lane: 'tests', probability: 0.9, run: true, reason: 'selected' },
      ],
    },
    results: [
      {
        lane: 'tests',
        status: 'concern',
        summary: 'Removed guard',
        taskIds: [],
        findings: [
          {
            path: 'src/route.ts',
            side: 'old',
            line: 7,
            concern: 'Guard was removed',
          },
        ],
      },
    ],
  };

  expect(renderAdaptiveComment(report, 'https://example.com/run')).toContain(
    'src/route.ts:7 (old): Guard was removed',
  );
});
