import { describe, expect, it } from 'vitest';

import {
  buildTaskReadinessReport,
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
    scenario: 'scratch-warm',
    coldCategory: 'warm_continuation',
    topology: 'split',
    authMode: 'agent_key',
    oryPlacement: 'local_sqlite',
    virtualization: 'kvm',
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

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({
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

  it('separates SQLite and Postgres Ory placements', () => {
    const report = buildTaskReadinessReport([
      sample('sqlite', 100),
      sample('postgres', 100, { oryPlacement: 'local_postgres' }),
    ]);

    expect(
      report.groups.map((group) => group.dimensions.oryPlacement).sort(),
    ).toEqual(['local_postgres', 'local_sqlite']);
  });

  it('rejects successful samples without the primary KPI', () => {
    expect(() =>
      buildTaskReadinessReport([
        sample('missing', 100, { firstUsefulReceivedAt: undefined }),
      ]),
    ).toThrow('has no useful event');
  });
});
