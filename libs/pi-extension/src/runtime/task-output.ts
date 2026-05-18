import { computeJsonCid } from '@moltnet/crypto-service';
import { metrics } from '@opentelemetry/api';
import { validateTaskOutput } from '@themoltnet/agent-runtime';

export interface ParsedTaskOutputResult {
  output: Record<string, unknown> | null;
  outputCid: string | null;
  error: { code: string; message: string } | null;
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

/**
 * Test-only hook: drop the cached counter so a fresh MeterProvider
 * registered between test cases is picked up. Production code must not
 * touch this — the counter is meant to be resolved once per process.
 */
export function __resetTaskOutputCounterForTests(): void {
  parseResultCounter = null;
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

export interface ParseStructuredTaskOutputOptions {
  /** Model identifier for the OTel counter label, e.g. `claude-sonnet-4-6`. */
  model?: string;
  /**
   * Original task input, when available. Required for task types whose
   * output validation depends on input fields.
   */
  input?: unknown;
}

export async function parseStructuredTaskOutput(
  assistantText: string,
  taskType: string,
  opts: ParseStructuredTaskOutputOptions = {},
): Promise<ParsedTaskOutputResult> {
  const record = (code: TaskOutputParseCode) =>
    recordTaskOutputParseResult({ taskType, model: opts.model, code });

  const extracted = extractJsonObject(assistantText);
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

  const errors = validateTaskOutput(taskType, extracted, opts.input);
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
    };
  }

  try {
    const outputCid = await computeJsonCid(extracted);
    record('success');
    return {
      output: extracted as Record<string, unknown>,
      outputCid,
      error: null,
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
    };
  }
}

/**
 * Find the last balanced top-level JSON object in `text` and parse it.
 * Tolerates markdown fences and leading prose. Returns null if parsing fails.
 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/gi;
  const candidates: string[] = [];
  for (const m of text.matchAll(fenceMatch)) {
    candidates.push(m[1]);
  }

  const scanForObject = (s: string): string | null => {
    let depth = 0;
    let start = -1;
    let lastComplete: string | null = null;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          lastComplete = s.slice(start, i + 1);
          start = -1;
        }
      }
    }
    return lastComplete;
  };

  candidates.push(text);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const obj = scanForObject(candidates[i]);
    if (!obj) continue;
    try {
      return JSON.parse(obj);
    } catch {
      /* try next */
    }
  }
  return null;
}
