import { metrics } from '@opentelemetry/api';
import type { SubmitRepair } from '@themoltnet/agent-runtime';

export interface CapturedTaskOutputResult {
  output: Record<string, unknown> | null;
  outputCid: string | null;
  error: { code: string; message: string } | null;
  repairs?: SubmitRepair[];
  /** Where an accepted payload came from. */
  source?: 'submit_tool' | 'final_message';
}

export type TaskOutputParseCode =
  | 'output_missing'
  | 'output_validation_failed'
  | 'output_cid_compute_failed'
  | 'captured_via_tool'
  | 'captured_via_final_message';

const METER_NAME = '@themoltnet/pi-extension/task-output';

let parseResultCounter: ReturnType<
  ReturnType<typeof metrics.getMeter>['createCounter']
> | null = null;
let telemetryAnomalyCounter: ReturnType<
  ReturnType<typeof metrics.getMeter>['createCounter']
> | null = null;
let repairCounter: ReturnType<
  ReturnType<typeof metrics.getMeter>['createCounter']
> | null = null;

function getParseResultCounter() {
  if (parseResultCounter) return parseResultCounter;
  parseResultCounter = metrics
    .getMeter(METER_NAME)
    .createCounter('agent_runtime.task_output.parse_result', {
      description:
        'Outcome of submit-tool output capture, labelled by task_type, model, and code (output_missing | output_validation_failed | output_cid_compute_failed | captured_via_tool | captured_via_final_message).',
      unit: '1',
    });
  return parseResultCounter;
}

function getTelemetryAnomalyCounter() {
  if (telemetryAnomalyCounter) return telemetryAnomalyCounter;
  telemetryAnomalyCounter = metrics
    .getMeter(METER_NAME)
    .createCounter('agent_runtime.task_output.telemetry_anomaly', {
      description:
        'Executor-observed telemetry anomalies on materialized task output, labelled by task_type, model, and kind.',
      unit: '1',
    });
  return telemetryAnomalyCounter;
}

/**
 * Test-only hook: drop the cached counter so a fresh MeterProvider
 * registered between test cases is picked up. Production code must not
 * touch this — the counter is meant to be resolved once per process.
 */
export function __resetTaskOutputCounterForTests(): void {
  parseResultCounter = null;
  telemetryAnomalyCounter = null;
  repairCounter = null;
}

export function recordTaskOutputRepairs(args: {
  taskType: string;
  model?: string;
  repairs: SubmitRepair[];
}): void {
  if (args.repairs.length === 0) return;
  repairCounter ??= metrics
    .getMeter(METER_NAME)
    .createCounter('agent_runtime.task_output.repair', {
      description:
        'Schema-alignment repairs, labelled by task_type, model, and kind.',
      unit: '1',
    });
  for (const repair of args.repairs) {
    repairCounter.add(1, {
      task_type: args.taskType,
      model: args.model ?? 'unknown',
      kind: repair.kind,
    });
  }
}

/**
 * Record one output-capture observation. Labels: `task_type`, `model`, `code`.
 */
export function recordTaskOutputParseResult(args: {
  taskType: string;
  model?: string;
  code: TaskOutputParseCode;
}): void {
  getParseResultCounter().add(1, {
    task_type: args.taskType,
    model: args.model ?? 'unknown',
    code: args.code,
  });
}

/** Record missing executor telemetry without changing the durable output. */
export function recordTaskOutputTelemetryAnomaly(args: {
  taskType: string;
  model?: string;
  kind: 'zero_usage' | 'zero_duration';
}): void {
  getTelemetryAnomalyCounter().add(1, {
    task_type: args.taskType,
    model: args.model ?? 'unknown',
    kind: args.kind,
  });
}
