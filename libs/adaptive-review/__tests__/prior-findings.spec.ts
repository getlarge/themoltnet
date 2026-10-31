import { describe, expect, it } from 'vitest';

import type { LaneResult } from '../src/lane.js';
import {
  accountForPriorFindings,
  focusedHistory,
  type PriorFindingOutcome,
} from '../src/prior-findings.js';
import { hasIncompleteCoverage, renderAdaptiveComment } from '../src/report.js';
import type { PreviousFinding } from '../src/threads.js';
import type { AdaptiveReport } from '../src/workflow.js';

const prior = (index = 0): PreviousFinding => ({
  key: `tests:new:${index + 1}:file.ts`,
  lane: 'tests',
  path: 'file.ts',
  line: index + 1,
  side: 'new',
  threadId: `thread-${index}`,
  url: `https://github.com/example/repo/pull/1#discussion_r${index}`,
  head: 'a'.repeat(40),
  isResolved: false,
  isOutdated: true,
  body: 'Missing timeout',
  replies: [],
});
const lane = (outcomes: PriorFindingOutcome[]): LaneResult => ({
  lane: 'tests',
  status: 'clear',
  summary: 'Done',
  taskIds: [],
  findings: [],
  priorFindingOutcomes: outcomes,
});
const report = (
  previous: PreviousFinding[],
  results: LaneResult[],
): AdaptiveReport => ({
  version: 1,
  mode: 'active',
  repo: 'example/repo',
  pr: 1,
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  correlationId: 'run',
  policyDigest: 'digest',
  referenceDigests: {},
  runtimeSha: 'c'.repeat(40),
  routing: {
    routes: [],
    scores: { 'code-complexity': null, 'review-effort': null },
    classifierFailed: false,
  },
  results,
  priorFindingOutcomes: accountForPriorFindings(previous, results),
  packetCount: 0,
  taskIds: [],
  gaps: [],
  durationMs: 1,
});

describe('prior finding accounting', () => {
  it('reports overflow individually as not checked while keeping model context bounded', () => {
    const previous = Array.from({ length: 21 }, (_, index) => prior(index));
    const selected = focusedHistory(previous, 'tests');
    expect(selected).toHaveLength(20);
    const result = report(previous, [
      lane(
        selected.map((item) => ({
          key: item.key,
          status: 'fixed',
          explanation: 'Current caller now supplies the timeout.',
        })),
      ),
    ]);
    expect(result.priorFindingOutcomes).toHaveLength(21);
    expect(result.priorFindingOutcomes?.[20]).toMatchObject({
      key: prior(20).key,
      status: 'not_checked',
      explanation: 'Outside the bounded prior-finding context for this run.',
    });
    expect(hasIncompleteCoverage(result)).toBe(true);
  });

  it('does not inherit another lane outcome or treat an omitted concern as fixed', () => {
    const result = accountForPriorFindings(
      [prior()],
      [
        {
          ...lane([
            {
              key: prior().key,
              status: 'fixed',
              explanation: 'Other lane claim',
            },
          ]),
          lane: 'performance',
        },
      ],
    );
    expect(result[0].status).toBe('not_checked');
    expect(accountForPriorFindings([prior()], [lane([])])[0].status).toBe(
      'not_checked',
    );
    expect(
      accountForPriorFindings([{ ...prior(), isResolved: true }], [lane([])]),
    ).toEqual([]);
  });

  it('renders all four conclusions, trusted thread links and current-head scope without closing threads', () => {
    const statuses = [
      'still_present',
      'fixed',
      'incorrect',
      'not_checked',
    ] as const;
    const previous = statuses.map((_, index) => prior(index));
    const result = report(previous, [
      lane(
        statuses.map((status, index) => ({
          key: prior(index).key,
          status,
          explanation: `${status}: inspect file.ts:42 <script> @someone`,
        })),
      ),
    ]);
    const comment = renderAdaptiveComment(result, 'https://example.com/run');
    for (const label of [
      'Still present',
      'Fixed',
      'Earlier finding was wrong',
      'Not checked / uncertain',
    ])
      expect(comment).toContain(`**${label}**`);
    expect(comment).toContain(prior().url);
    expect(comment).toContain('bbbbbbb');
    expect(comment).toContain('GitHub threads are not automatically resolved');
    expect(comment).not.toContain('Nothing needs fixing');
    expect(comment).not.toContain('<script>');
    expect(comment).not.toContain('@someone');
  });

  it('keeps every result in the artifact and explicitly counts outcomes omitted from a bounded comment', () => {
    const previous = Array.from({ length: 45 }, (_, index) => prior(index));
    const result = report(previous, []);
    const comment = renderAdaptiveComment(result, 'https://example.com/run');
    expect(result.priorFindingOutcomes).toHaveLength(45);
    expect(comment).toContain('Not checked / uncertain: 45');
    expect(comment).toContain('5 more individual assessments');
  });
});
