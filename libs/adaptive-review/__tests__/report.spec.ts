import { expect, it } from 'vitest';

import { LANES } from '../src/core.js';
import {
  ADAPTIVE_FINDING_MARKER,
  findingKey,
  hasIncompleteCoverage,
  inlineFindings,
  parseFindingMarker,
  postedFindingKey,
  renderAdaptiveComment,
  renderFindingComment,
} from '../src/report.js';
import type { AdaptiveReport } from '../src/workflow.js';

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
  report.spend = { version: 1, records: [], discoveryIncomplete: true };
  const comment = renderAdaptiveComment(
    report,
    'https://github.com/getlarge/themoltnet/actions/runs/1',
  );
  expect(comment).toContain('screened, not investigated');
  expect(comment).toContain('A screened lane was not investigated.');
  expect(comment).toContain('### Agent workflow spend');
  expect(comment).toContain('Task discovery is incomplete');
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

  report.results.push({
    lane: 'complexity',
    status: 'concern',
    summary: 'Overall acceptable.',
    taskIds: [],
    // Compatibility with a report produced before rubric failures stopped
    // being converted into pathless findings.
    findings: [{ path: '', concern: 'cognitive_load: Added branching.' }],
  });
  const rendered = renderAdaptiveComment(report, 'https://example.com/run');
  expect(rendered).toContain('src/route.ts:7 (old): Guard was removed');
  expect(rendered).toContain('Findings: 1.');
  expect(rendered).toContain('### Complexity assessment');
  expect(rendered).toContain('cognitive_load: Added branching.');
  for (const posted of [0, 1]) {
    const comment = renderAdaptiveComment(report, 'https://example.com/run', {
      posted,
      existing: 0,
      keys: new Set<string>(),
      resolved: new Set<string>(),
    });
    expect(comment).toContain(
      'Assess each finding; fix confirmed problems or explain why no change is needed.',
    );
    expect(comment).not.toContain('Fix each one');
    if (posted === 0) expect(comment).toContain('1 listed below');
  }
});

it.each(['clear', 'concern', 'unclear', 'failed', 'screened'] as const)(
  'distinguishes selected security coverage from %s execution results',
  (status) => {
    const report: AdaptiveReport = {
      version: 1,
      mode: 'shadow',
      repo: 'getlarge/themoltnet',
      pr: 42,
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
      runtimeSha: 'c'.repeat(40),
      correlationId: 'id',
      policyDigest: 'd'.repeat(64),
      referenceDigests: {},
      packetCount: 1,
      taskIds: [],
      gaps: [],
      durationMs: 100,
      routing: {
        classifierFailed: false,
        scores: { 'code-complexity': null, 'review-effort': null },
        routes: [
          { lane: 'security', probability: 0.9, run: true, reason: 'selected' },
        ],
      },
      results: [
        {
          lane: 'security',
          status,
          summary: 'Security candidates: 0 confirmed, 0 unresolved, 0 refuted.',
          taskIds: [],
          findings: [],
        },
      ],
    };
    const comment = renderAdaptiveComment(report, 'https://example.com/run');
    expect(comment).toContain(
      'All enabled lanes were selected for investigation.',
    );
    expect(comment).toContain('Selection does not imply complete coverage');
    expect(comment).not.toContain('every enabled lane was investigated');
    const incomplete = status !== 'clear' && status !== 'concern';
    expect(hasIncompleteCoverage(report)).toBe(incomplete);
    expect(
      renderAdaptiveComment(report, 'https://example.com/run').includes(
        'review: incomplete coverage',
      ),
    ).toBe(incomplete);
    report.results[0].unclear = ['Some changed contents remain unassessed.'];
    expect(hasIncompleteCoverage(report)).toBe(true);
    expect(renderAdaptiveComment(report, 'https://example.com/run')).toContain(
      'incomplete coverage',
    );
    report.results = [];
    expect(hasIncompleteCoverage(report)).toBe(true);
    report.routing.routes[0].run = false;
    expect(hasIncompleteCoverage(report)).toBe(false);
    report.gaps = ['Truncated diff'];
    expect(hasIncompleteCoverage(report)).toBe(true);
  },
);

it('lists confirmed security findings and unresolved candidates', () => {
  // Arrange
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
        { lane: 'security', probability: 0.9, run: true, reason: 'selected' },
      ],
    },
    results: [
      {
        lane: 'security',
        status: 'concern',
        summary:
          'Security candidates: 1 confirmed (highest severity: medium), 1 unresolved, 0 refuted.',
        unclear: [
          'Unresolved at src/tag.ts:3: Mutable tag. Tag rulesets are not in the checkout.',
        ],
        taskIds: ['hunt', 'verify'],
        findings: [
          {
            path: 'src/release.ts',
            side: 'new',
            line: 9,
            concern: 'Medium severity: Checksum database bypassed.',
            action: 'Verify the module hash.',
          },
        ],
      },
    ],
  };

  // Act
  const comment = renderAdaptiveComment(report, 'https://example.com/run');

  // Assert
  expect(inlineFindings(report.results)).toHaveLength(1);
  expect(comment).toContain(
    'src/release.ts:9: Medium severity: Checksum database bypassed.',
  );
  expect(comment).toContain(
    'security: Unresolved at src/tag.ts:3: Mutable tag. Tag rulesets are not in the checkout.',
  );
  expect(comment).not.toContain('team-scoped');
});

it('says plainly when nothing needs fixing', () => {
  // Arrange
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
      scores: { 'code-complexity': 0, 'review-effort': 0 },
      routes: [
        { lane: 'tests', probability: 0.9, run: true, reason: 'selected' },
      ],
    },
    results: [
      {
        lane: 'tests',
        status: 'clear',
        summary: 'Covered',
        taskIds: [],
        findings: [],
      },
    ],
  };

  // Act
  const comment = renderAdaptiveComment(report, 'https://example.com/run');

  // Assert
  expect(comment).toContain(
    'Findings: 0. No actionable findings were reported.',
  );
  expect(comment).not.toContain('A screened lane was not investigated.');
  expect(comment).toContain('_Advisory review._');
});

it('round-trips a finding key through the thread marker and neutralizes the body', () => {
  // Arrange
  const finding = {
    lane: 'conventions' as const,
    path: 'libs/a b/[x].ts',
    side: 'new' as const,
    line: 12,
    concern: '@owner reads process.env <b>',
    action: 'Use [config](bad).ts',
  };

  // Act
  const body = renderFindingComment(finding);

  // Assert
  expect(postedFindingKey(body)).toBe(findingKey(finding));
  expect(findingKey(finding)).toBe(
    'conventions:new:12:libs%2Fa%20b%2F%5Bx%5D.ts',
  );
  expect(body).toContain('@​owner reads process.env &lt;b&gt;');
  expect(body).toContain('Suggested action: Use \\[config\\](bad).ts');
  expect(postedFindingKey('plain comment')).toBeUndefined();
  expect(
    postedFindingKey('<!-- moltnet:adaptive-finding  -->'),
  ).toBeUndefined();
});

it('records the producing run and tasks in the marker without changing the key', () => {
  // Arrange
  const finding = {
    lane: 'tests' as const,
    path: 'src/a.ts',
    side: 'new' as const,
    line: 3,
    concern: 'untested',
  };
  const source = {
    runUrl: 'https://github.com/getlarge/themoltnet/actions/runs/9',
    correlationId: 'adaptive review/42',
  };

  // Act
  const marker = parseFindingMarker(renderFindingComment(finding, source));
  const legacy = parseFindingMarker(
    `${ADAPTIVE_FINDING_MARKER}${findingKey(finding)} -->`,
  );

  // Assert
  expect(marker).toEqual({ key: findingKey(finding), ...source });
  expect(legacy).toEqual({ key: findingKey(finding) });
});
