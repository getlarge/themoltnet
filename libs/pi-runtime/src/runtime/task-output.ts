import { computeJsonCid } from '@moltnet/crypto-service/json-cid';
import { parseCompleteJsonObject } from '@moltnet/json-repair';
import { metrics } from '@opentelemetry/api';
import {
  alignToSchema,
  getAgentSubmissionSchema,
  type SchemaAlignmentRepair,
  validateAgentTaskSubmission,
} from '@themoltnet/agent-runtime';

export interface ParsedTaskOutputResult {
  output: Record<string, unknown> | null;
  outputCid: string | null;
  error: { code: string; message: string } | null;
  repairs?: SchemaAlignmentRepair[];
}

export type TaskOutputParseCode =
  | 'success'
  | 'output_missing'
  | 'output_validation_failed'
  | 'unknown_task_type'
  | 'output_cid_compute_failed'
  | 'captured_via_tool';

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
        'Outcome of structured task-output capture, labelled by task_type, model, and code (success | output_missing | output_validation_failed | unknown_task_type | output_cid_compute_failed | captured_via_tool).',
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
  repairs: SchemaAlignmentRepair[];
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
 * Record one parse-result observation. Exposed so the executor can also
 * record the `captured_via_tool` outcome from the submit-tool path
 * without bouncing through the parser. Labels: `task_type`, `model`, `code`.
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

export interface ParseStructuredTaskOutputOptions {
  /** Model identifier for the OTel counter label, e.g. `claude-sonnet-4-6`. */
  model?: string;
  /**
   * Original task input, when available. Required for task types whose
   * output validation depends on input fields.
   */
  input?: unknown;
  /** Canonical CID of the task input for verification cross-field checks. */
  inputCid?: string;
}

export async function parseStructuredTaskOutput(
  assistantText: string,
  taskType: string,
  opts: ParseStructuredTaskOutputOptions = {},
): Promise<ParsedTaskOutputResult> {
  const record = (code: TaskOutputParseCode) =>
    recordTaskOutputParseResult({ taskType, model: opts.model, code });

  const extracted = parseCompleteJsonObject(assistantText);
  if (!extracted) {
    record('output_missing');
    return {
      output: null,
      outputCid: null,
      error: {
        code: 'output_missing',
        message:
          'Agent did not emit a parseable JSON object as its final message.',
      },
    };
  }

  const schema = getAgentSubmissionSchema(taskType, opts.input);
  const aligned = schema
    ? alignToSchema(extracted.value, schema)
    : { value: extracted.value, repairs: [] };
  const repairs: SchemaAlignmentRepair[] = [
    ...extracted.repairs.map((kind) => ({ kind, path: '' }) as const),
    ...aligned.repairs,
  ];
  recordTaskOutputRepairs({ taskType, model: opts.model, repairs });
  const errors = validateAgentTaskSubmission(
    taskType,
    aligned.value,
    opts.input,
    {
      inputCid: opts.inputCid,
    },
  );
  if (errors.length > 0) {
    const details = errors
      .slice(0, 3)
      .map((error) => `${error.field}: ${error.message}`);
    const [firstError] = errors;
    const code: TaskOutputParseCode =
      firstError?.field === 'taskType'
        ? 'unknown_task_type'
        : 'output_validation_failed';
    record(code);
    return {
      output: null,
      outputCid: null,
      error: {
        code,
        message: `Output failed schema validation: ${details.join('; ')}`,
      },
      repairs,
    };
  }

  try {
    const outputCid = await computeJsonCid(aligned.value);
    record('success');
    return {
      output: aligned.value as Record<string, unknown>,
      outputCid,
      error: null,
      repairs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('output_cid_compute_failed');
    return {
      output: null,
      outputCid: null,
      error: {
        code: 'output_cid_compute_failed',
        message: `Validated output could not be canonicalized: ${message}`,
      },
      repairs,
    };
  }
}

/** Return the last complete final-message object, if one can be parsed. */
export function extractJsonObject(text: string): unknown {
  return parseCompleteJsonObject(text)?.value ?? null;
}
