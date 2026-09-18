import { context, metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type CollectionResult,
  type DataPoint,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetToolPolicyMetricsForTests,
  recordToolPolicyDecisionMetric,
  recordToolPolicyDecisionSpan,
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
    recordToolPolicyDecisionMetric({
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
    recordToolPolicyDecisionMetric({
      decision: 'allowed',
      reason: 'policy_allowed',
      enforcement: 'enforce',
      degraded: false,
    });
    recordToolPolicyDecisionMetric({
      decision: 'allowed',
      reason: 'policy_allowed',
      enforcement: 'enforce',
      degraded: false,
    });
    recordToolPolicyDecisionMetric({
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
    recordToolPolicyDecisionMetric({
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

describe('recordToolPolicyDecisionSpan', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
  });

  const blocked = {
    decision: 'blocked' as const,
    tool_name: 'bash',
    reason_code: 'tool_not_permitted',
    enforcement: 'enforce',
    degraded: false,
    policy_snapshot_hash: 'sha256:feedface',
    runtime_profile_revision: 9,
    unauthorized_executables: ['curl'],
  };

  it('records a completed span carrying the decision', () => {
    recordToolPolicyDecisionSpan(blocked, undefined, {
      'moltnet.task.id': 'task-1',
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    // Ended, not left open: an unfinished span never reaches the collector.
    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.name).toBe('moltnet.tool_policy.decision');
    expect(spans[0]?.attributes).toMatchObject({
      'moltnet.tool_policy.decision': 'blocked',
      'moltnet.tool_policy.reason': 'tool_not_permitted',
      'moltnet.tool_policy.enforcement': 'enforce',
      'moltnet.tool_policy.snapshot_hash': 'sha256:feedface',
      'moltnet.runtime_profile.revision': 9,
      'gen_ai.tool.name': 'bash',
      'moltnet.task.id': 'task-1',
    });
  });

  it('parents the span to the supplied session context', () => {
    const parent = provider.getTracer('test').startSpan('session');
    const parentContext = trace.setSpan(context.active(), parent);

    recordToolPolicyDecisionSpan(blocked, parentContext);
    parent.end();

    const decision = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'moltnet.tool_policy.decision');
    expect(decision?.parentSpanContext?.spanId).toBe(
      parent.spanContext().spanId,
    );
    expect(decision?.spanContext().traceId).toBe(parent.spanContext().traceId);
  });

  it('records a watch-mode decision as would_block', () => {
    recordToolPolicyDecisionSpan(
      { ...blocked, decision: 'would_block', enforcement: 'watch' },
      undefined,
    );
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      'moltnet.tool_policy.decision': 'would_block',
      'moltnet.tool_policy.enforcement': 'watch',
    });
  });

  it('carries no argv literals', () => {
    recordToolPolicyDecisionSpan(
      { ...blocked, unauthorized_executables: ['curl'] },
      undefined,
    );
    // The command was `curl -H "Authorization: Bearer ..." https://...`; only
    // the executable may appear, never its arguments.
    const serialized = JSON.stringify(
      exporter.getFinishedSpans()[0]?.attributes,
    );
    expect(serialized).toContain('curl');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('https://');
  });

  it('never throws when the tracer is unavailable', () => {
    trace.disable();
    expect(() =>
      recordToolPolicyDecisionSpan(blocked, undefined),
    ).not.toThrow();
  });
});
