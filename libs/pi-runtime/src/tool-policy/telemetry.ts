import {
  type Attributes,
  type Context,
  type Counter,
  metrics,
  trace,
} from '@opentelemetry/api';

import type { ToolEnforcement, ToolPolicyDecisionReason } from './gate.js';

const METER_NAME = '@themoltnet/pi-extension/tool-policy';

/**
 * Counts every tool-policy decision, so refusals are visible in telemetry and
 * not only in a task record.
 *
 * This is the only export path a policy decision has. The daemon ships traces
 * and metrics over OTLP but registers no log exporter, so the
 * `tool_policy.blocked` pino line reaches the operator's stderr and nowhere
 * else. A blocked call is also absent from traces entirely: the gate refuses at
 * pi's `tool_call` event, which is earlier than the `tool_execution_start` the
 * OTel extension hooks, so no `execute_tool` span is ever created for it.
 *
 * Allowed decisions are counted too — without the denominator a refusal count
 * cannot be read as a rate.
 */
let decisionCounter: Counter | null = null;

function getDecisionCounter(): Counter {
  decisionCounter ??= metrics
    .getMeter(METER_NAME)
    .createCounter('agent_runtime.tool_policy.decisions', {
      description:
        'Runtime tool-policy decisions by outcome, reason and enforcement mode.',
      unit: '1',
    });
  return decisionCounter;
}

/** Test-only: the meter is resolved once per process and cached. */
export function __resetToolPolicyMetricsForTests(): void {
  decisionCounter = null;
}

export interface ToolPolicyDecisionMetric {
  decision: 'allowed' | 'blocked' | 'would_block';
  reason: ToolPolicyDecisionReason;
  enforcement: ToolEnforcement;
  degraded: boolean;
}

/**
 * Attributes are deliberately low-cardinality: outcome, reason code,
 * enforcement mode and the degraded flag are all small closed sets. Task,
 * team, lease and tool-call ids are never attached — they are unbounded, and
 * the collector strips task ids from public metric datapoints anyway. The
 * per-decision detail lives in the task record instead.
 */
export function recordToolPolicyDecision(
  metric: ToolPolicyDecisionMetric,
): void {
  try {
    getDecisionCounter().add(1, {
      decision: metric.decision,
      reason: metric.reason,
      enforcement: metric.enforcement,
      degraded: String(metric.degraded),
    });
  } catch {
    // Telemetry must never change a policy verdict.
  }
}

const TRACER_NAME = '@themoltnet/pi-extension/tool-policy';

export interface ToolPolicyDecisionSpanInput {
  decision: 'blocked' | 'would_block';
  tool_name: string;
  reason_code: string;
  enforcement: string;
  degraded: boolean;
  policy_snapshot_hash?: string;
  runtime_profile_revision?: number;
  unauthorized_executables?: string[];
}

/**
 * Record a refusal on the trace.
 *
 * A blocked call has no span of its own otherwise: the gate refuses at pi's
 * `tool_call` event, which is earlier than the `tool_execution_start` that
 * creates `execute_tool`, so the call simply never appears. This span is that
 * missing evidence, parented to the live session span so it lands in the same
 * trace as the turn that attempted it.
 *
 * Unlike the counter, a span tolerates high cardinality, so it carries the
 * correlation fields the metric deliberately leaves off. It still carries no
 * argv literals — the executables and the record's fingerprints identify the
 * invocation without reproducing its arguments.
 *
 * The status is left UNSET on purpose: a refusal is the policy working, not a
 * system fault, and marking it ERROR would put correct behaviour in error views.
 */
export function recordToolPolicyDecisionSpan(
  input: ToolPolicyDecisionSpanInput,
  parentContext: Context | undefined,
  correlation: Attributes = {},
): void {
  try {
    const attributes: Attributes = {
      ...correlation,
      'moltnet.tool_policy.decision': input.decision,
      'moltnet.tool_policy.reason': input.reason_code,
      'moltnet.tool_policy.enforcement': input.enforcement,
      'moltnet.tool_policy.degraded': input.degraded,
      'gen_ai.tool.name': input.tool_name,
      ...(input.policy_snapshot_hash
        ? { 'moltnet.tool_policy.snapshot_hash': input.policy_snapshot_hash }
        : {}),
      ...(input.runtime_profile_revision !== undefined
        ? {
            'moltnet.runtime_profile.revision': input.runtime_profile_revision,
          }
        : {}),
      ...(input.unauthorized_executables?.length
        ? {
            'moltnet.tool_policy.unauthorized_executables':
              input.unauthorized_executables,
          }
        : {}),
    };
    const tracer = trace.getTracer(TRACER_NAME);
    const span = parentContext
      ? tracer.startSpan(
          'moltnet.tool_policy.decision',
          { attributes },
          parentContext,
        )
      : tracer.startSpan('moltnet.tool_policy.decision', { attributes });
    span.end();
  } catch {
    // Telemetry must never change a policy verdict.
  }
}
