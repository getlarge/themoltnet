import { describe, expect, it } from 'vitest';

import {
  buildTaskReadinessReport,
  parseTaskReadinessSample,
  type TaskReadinessSample,
} from './bench-task-readiness.js';

function sample(
  runId: string,
  latencyMs: number,
  overrides: Partial<TaskReadinessSample> = {},
): TaskReadinessSample {
  const queuedAt = Date.parse('2026-08-06T10:00:00.000Z');
  return {
    runId,
    queuedAt: new Date(queuedAt).toISOString(),
    firstUsefulReceivedAt: new Date(queuedAt + latencyMs).toISOString(),
    completedAt: new Date(queuedAt + latencyMs + 1_000).toISOString(),
    success: true,
    phaseMs: { claim: latencyMs / 2 },
    resources: { cpuPct: 25 },
    ...overrides,
  };
}

describe('buildTaskReadinessReport', () => {
  it('produces stable nearest-rank percentiles and resource summaries', () => {
    const report = buildTaskReadinessReport(
      [sample('a', 100), sample('b', 200), sample('c', 900)],
      '2026-08-06T12:00:00.000Z',
    );

    expect(report).toMatchObject({
      tasks: 3,
      successes: 3,
      errors: 0,
      errorRate: 0,
      queuedToFirstUsefulMs: {
        count: 3,
        min: 100,
        p50: 200,
        p95: 900,
        p99: 900,
        max: 900,
        mean: 400,
      },
      phaseMs: { claim: { p50: 100 } },
      resources: { cpuPct: { p95: 25 } },
    });
  });

  it('rejects successful samples without the primary KPI', () => {
    expect(() =>
      buildTaskReadinessReport([
        sample('missing', 100, { firstUsefulReceivedAt: undefined }),
      ]),
    ).toThrow('has no useful event');
  });

  it('includes useful-event latency even when the task later fails', () => {
    const report = buildTaskReadinessReport([
      sample('failed-after-useful', 250, { success: false }),
    ]);

    expect(report.queuedToFirstUsefulMs).toMatchObject({
      count: 1,
      p50: 250,
    });
    expect(report).toMatchObject({ successes: 0, errors: 1 });
  });

  it('reports null throughput for a zero-width observation window', () => {
    const instant = sample('instant', 0, {
      completedAt: '2026-08-06T10:00:00.000Z',
    });

    expect(buildTaskReadinessReport([instant]).throughputPerMinute).toBeNull();
  });

  it.each(['null', '[]', '42'])(
    'rejects non-object JSONL samples with their line number: %s',
    (line) => {
      expect(() => parseTaskReadinessSample(line, 7)).toThrow(
        'Invalid sample on line 7: expected a JSON object',
      );
    },
  );
});
