import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type CollectionResult,
  type DataPoint,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetToolPolicyMetricsForTests,
  recordToolPolicyDecision,
} from './telemetry.js';

class CollectingReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.CUMULATIVE;
  }
  async snapshot(): Promise<CollectionResult> {
    return this.collect();
  }
}

describe('recordToolPolicyDecision', () => {
  let provider: MeterProvider;
  let reader: CollectingReader;

  beforeEach(() => {
    reader = new CollectingReader();
    provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    __resetToolPolicyMetricsForTests();
  });

  afterEach(async () => {
    await provider.shutdown();
    metrics.disable();
    __resetToolPolicyMetricsForTests();
  });

  async function dataPoints(): Promise<DataPoint<number>[]> {
    const { resourceMetrics } = await reader.snapshot();
    const points: DataPoint<number>[] = [];
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== 'agent_runtime.tool_policy.decisions') {
          continue;
        }
        points.push(...(metric.dataPoints as DataPoint<number>[]));
      }
    }
    return points;
  }

  it('counts a refusal with its outcome, reason and enforcement mode', async () => {
    recordToolPolicyDecision({
      decision: 'blocked',
      reason: 'tool_not_permitted',
      enforcement: 'enforce',
      degraded: false,
    });

    const points = await dataPoints();
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(1);
    expect(points[0]?.attributes).toEqual({
      decision: 'blocked',
      reason: 'tool_not_permitted',
      enforcement: 'enforce',
      degraded: 'false',
    });
  });

  it('separates outcomes so a refusal rate can be derived', async () => {
    recordToolPolicyDecision({
      decision: 'allowed',
      reason: 'policy_allowed',
      enforcement: 'enforce',
      degraded: false,
    });
    recordToolPolicyDecision({
      decision: 'allowed',
      reason: 'policy_allowed',
      enforcement: 'enforce',
      degraded: false,
    });
    recordToolPolicyDecision({
      decision: 'would_block',
      reason: 'arbitrary_code_interpreter',
      enforcement: 'watch',
      degraded: false,
    });

    const byDecision = Object.fromEntries(
      (await dataPoints()).map((point) => [
        point.attributes.decision,
        point.value,
      ]),
    );
    expect(byDecision).toEqual({ allowed: 2, would_block: 1 });
  });

  it('carries no unbounded attributes', async () => {
    recordToolPolicyDecision({
      decision: 'blocked',
      reason: 'tool_not_permitted',
      enforcement: 'enforce',
      degraded: true,
    });

    // Task, team, lease and tool-call ids would make this series unbounded;
    // the per-decision detail belongs in the task record instead.
    const keys = Object.keys((await dataPoints())[0]?.attributes ?? {});
    expect(keys.sort()).toEqual([
      'decision',
      'degraded',
      'enforcement',
      'reason',
    ]);
  });
});
