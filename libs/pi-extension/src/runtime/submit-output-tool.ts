/**
 * Per-task-type "submit output" tool that captures the validated payload
 * via a closure and surfaces it to the executor.
 *
 * Behaviour:
 *
 *   1. Tool args are validated against the task type's TypeBox output
 *      schema. Schema violations return as a tool-error within the
 *      conversation, so the model can retry on the next turn — the same
 *      affordance models already use heavily. This is the primary win
 *      over the parser path: a malformed args call is recoverable
 *      mid-session, not session-ending.
 *
 *   2. On a valid call, the validated args are stored in the captured
 *      reference exposed via `getCaptured()`. The executor reads that
 *      captured state after `session.prompt()` resolves instead of using
 *      Pi's `terminate` flag as task-completion control flow.
 *
 *   3. If the model somehow calls the tool more than once, the latest
 *      valid call wins. This matches "submit exactly once" semantics
 *      from the prompt while staying defensive against retries.
 *
 * The model still has to *decide* to call the tool — pi-coding-agent's
 * `AgentLoopConfig` does not expose `toolChoice`, so we cannot force the
 * call. The strict closing block in the system prompt (commit 1 of this
 * PR) carries that weight.
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  getSubmitOutputContract,
  SUBMIT_OUTPUT_GATE_ID,
  validateTaskOutput,
} from '@themoltnet/agent-runtime';
import { Type } from 'typebox';

import { recordTaskOutputParseResult } from './task-output.js';

interface SubmitOutputDetails {
  captured: boolean;
  callCount: number;
  error: string | null;
  invalidCallCount?: number;
  maxSubmitValidationRetries?: number;
}

export interface CreateSubmitOutputToolOptions {
  /**
   * Optional model identifier for the OTel counter labels. Mirrors the
   * `model` opt threaded into `parseStructuredTaskOutput` so the
   * submit-tool path's `output_validation_failed` and
   * `captured_via_tool` observations carry the same `{task_type, model}`
   * cardinality.
   */
  model?: string;
  /**
   * Original task input, threaded into output validation so task types
   * with cross-field rules (for example "verification required iff
   * input.successCriteria exists") are enforced before output is
   * captured.
   */
  input?: unknown;
  /**
   * CID for `input`, used only for runtime-owned verification facts. In
   * particular, the submit-output tool can prove the built-in
   * submit-output gate once it accepts valid args.
   */
  inputCid?: string;
  /**
   * Number of correction turns allowed after the first invalid submit call.
   * A value of 2 permits three invalid submissions total, then records an
   * exhausted validation failure so the attempt can fail with
   * output_validation_failed after the session ends.
   */
  maxSubmitValidationRetries?: number;
}

export interface SubmitOutputToolHandle {
  /** ToolDefinition to register via `customTools` on the agent session. */
  tool: ToolDefinition<any, any>;
  /**
   * Registered tool name (`submit_<task_type>_output`). Exposed so the
   * executor can name the exact tool in the submit-missing re-prompt without
   * re-resolving the contract. See #1528.
   */
  toolName: string;
  /**
   * Latest validated payload submitted by the model, or `null` if the
   * model never produced a valid call. Read after `session.prompt()`
   * resolves — the executor prefers this over `parseStructuredTaskOutput`.
   */
  getCaptured: () => Record<string, unknown> | null;
  /** Number of times the model called the tool with valid args. */
  getCallCount: () => number;
  /** Number of invalid submit calls observed in this session. */
  getInvalidCallCount: () => number;
  /** Last validation failure, if the model submitted invalid args. */
  getLastValidationFailure: () => { code: string; message: string } | null;
  /** Validation failure that exhausted the correction budget. */
  getExhaustedValidationFailure: () => {
    code: string;
    message: string;
  } | null;
}

/**
 * Sentinel thrown when the requested task type has no registered output
 * schema. The executor recognises this specific error class and falls
 * back to the parser path; any other error from `createSubmitOutputTool`
 * is unexpected and must propagate.
 */
export class UnknownTaskTypeForSubmitToolError extends Error {
  constructor(public readonly taskType: string) {
    super(
      `createSubmitOutputTool: no output schema registered for task type "${taskType}"`,
    );
    this.name = 'UnknownTaskTypeForSubmitToolError';
  }
}

const DEFAULT_MAX_SUBMIT_VALIDATION_RETRIES = 2;

// Pi validates tool arguments before execute() runs. Register a permissive
// top-level object so malformed submit payloads reach our strict validator and
// can be returned as recoverable tool errors inside the same session.
const RecoverableSubmitToolParameters = Type.Object(
  {},
  { additionalProperties: Type.Unknown() },
);

function formatValidationErrors(
  errors: ReturnType<typeof validateTaskOutput>,
): string {
  return errors.map((err) => `${err.field}: ${err.message}`).join('; ');
}

function submitOutputRepairHint(
  taskType: string,
  errors: ReturnType<typeof validateTaskOutput>,
): string {
  const fields = new Set(errors.map((err) => err.field));
  const hints: string[] = [
    'Tool args must be the output object directly, not wrapped in { output: ... }.',
  ];

  if (fields.has('output/artifacts')) {
    hints.push(
      '`artifacts` must be an array; omit it when there are no artifacts, use [], or use objects like { "kind": "note", "title": "Result", "body": "..." }.',
    );
  }

  if (fields.has('output/verification')) {
    hints.push(
      '`verification` must be an object with inputCid, results[], and passed; do not send it as text or an array.',
    );
  }

  if (
    taskType === 'freeform' &&
    (fields.has('output/artifacts') || fields.has('output/verification'))
  ) {
    hints.push(
      'Minimal valid freeform retry: { "summary": "completed", "artifacts": [], "verification": { "inputCid": "<task inputCid>", "results": [{ "id": "submit-output", "kind": "gate", "status": "pass", "detail": "submit_freeform_output accepted valid args" }], "passed": true } }.',
    );
  }

  if (hints.length === 1) {
    hints.push('Fix every listed field before re-calling this same tool.');
  }

  return hints.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlySubmitOutputGate(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.successCriteria)) return false;
  const criteria = input.successCriteria;
  const gates = criteria.gates;
  if (!Array.isArray(gates) || gates.length !== 1) return false;
  const [gate] = gates;
  if (!isRecord(gate) || gate.id !== SUBMIT_OUTPUT_GATE_ID) return false;

  const assertions = criteria.assertions;
  if (Array.isArray(assertions) && assertions.length > 0) return false;
  return (
    criteria.rubric === undefined &&
    criteria.sideEffects === undefined &&
    criteria.minComposite === undefined
  );
}

function repairFreeformSubmitOutput(
  params: unknown,
  opts: CreateSubmitOutputToolOptions,
): Record<string, unknown> | null {
  if (
    !isRecord(params) ||
    !opts.inputCid ||
    !onlySubmitOutputGate(opts.input)
  ) {
    return null;
  }

  const repaired: Record<string, unknown> = { ...params };

  if ('artifacts' in repaired && !Array.isArray(repaired.artifacts)) {
    if (isRecord(repaired.artifacts)) {
      repaired.artifacts = [repaired.artifacts];
    } else {
      delete repaired.artifacts;
    }
  }

  if ('proposedTaskType' in repaired && !isRecord(repaired.proposedTaskType)) {
    if (
      typeof repaired.proposedTaskType === 'string' &&
      repaired.proposedTaskType.length > 0
    ) {
      repaired.proposedTaskType = {
        name: repaired.proposedTaskType,
        rationale: 'Suggested by the model during freeform execution.',
      };
    } else {
      delete repaired.proposedTaskType;
    }
  }

  repaired.verification = {
    inputCid: opts.inputCid,
    results: [
      {
        id: SUBMIT_OUTPUT_GATE_ID,
        kind: 'gate',
        status: 'pass',
        detail: 'submit_freeform_output accepted valid args',
      },
    ],
    passed: true,
  };

  return repaired;
}

function maybeRepairSubmitOutput(
  taskType: string,
  params: unknown,
  opts: CreateSubmitOutputToolOptions,
): Record<string, unknown> | null {
  if (taskType !== 'freeform') return null;
  const repaired = repairFreeformSubmitOutput(params, opts);
  if (!repaired) return null;
  return validateTaskOutput(taskType, repaired, opts.input).length === 0
    ? repaired
    : null;
}

export function createSubmitOutputTool(
  taskType: string,
  opts: CreateSubmitOutputToolOptions = {},
): SubmitOutputToolHandle {
  // The (toolName, description, parametersSchema) triple lives in
  // @themoltnet/agent-runtime so the prompt builder and any executor
  // share one source of truth. pi-extension is the executor; future
  // executors (Codex SDK adapter, etc.) read the same contract.
  const contract = getSubmitOutputContract(taskType);
  if (!contract) {
    throw new UnknownTaskTypeForSubmitToolError(taskType);
  }
  const maxSubmitValidationRetries =
    opts.maxSubmitValidationRetries ?? DEFAULT_MAX_SUBMIT_VALIDATION_RETRIES;

  let captured: Record<string, unknown> | null = null;
  let callCount = 0;
  let invalidCallCount = 0;
  let lastValidationFailure: { code: string; message: string } | null = null;
  let exhaustedValidationFailure: { code: string; message: string } | null =
    null;

  const tool = defineTool({
    name: contract.toolName,
    label: `Submit ${taskType} output`,
    description: contract.description,
    promptSnippet:
      `${contract.toolName}: submit the final structured ${taskType} ` +
      'output using the schema shown in the task prompt.',
    promptGuidelines: [
      `Call \`${contract.toolName}\` with the exact ${taskType} output shape shown in the task prompt.`,
      'If the submit tool returns a validation error, fix every listed field and call the same tool again.',
    ],
    parameters: RecoverableSubmitToolParameters,
    async execute(_id, params) {
      if (exhaustedValidationFailure) {
        const details: SubmitOutputDetails = {
          captured: false,
          callCount,
          invalidCallCount,
          maxSubmitValidationRetries,
          error: 'output_validation_failed',
        };
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Submit-output validation retry budget is already exhausted; ' +
                'the attempt will fail.',
            },
          ],
          details,
          isError: true,
        };
      }

      // Use the registry-aware validator: runs the TypeBox schema check
      // AND any task-type-specific cross-field rule (e.g. judge_pack's
      // `llm_checklist` score↔assertions consistency from #999). Without
      // the cross-field pass, an LLM that submits `score: 1` alongside a
      // failing assertion sails through here and the bad payload
      // pollutes attestations. Returning isError:true lets the agent
      // re-call with a corrected payload mid-session — same recovery
      // affordance as a plain schema miss.
      const repairedParams = maybeRepairSubmitOutput(taskType, params, opts);
      const candidateParams = repairedParams ?? params;
      const errors = validateTaskOutput(taskType, candidateParams, opts.input);
      if (errors.length > 0) {
        invalidCallCount += 1;
        const detailMsg = formatValidationErrors(errors);
        const maxInvalidCalls = maxSubmitValidationRetries + 1;
        const exhausted = invalidCallCount >= maxInvalidCalls;
        const message =
          `Output failed validation (${invalidCallCount}/${maxInvalidCalls}): ` +
          `${detailMsg}. ` +
          `${submitOutputRepairHint(taskType, errors)} ` +
          (exhausted
            ? 'Submit-output validation retry budget exhausted; the attempt will fail.'
            : 'Re-call this tool with a corrected output.');
        lastValidationFailure = {
          code: 'output_validation_failed',
          message,
        };
        if (exhausted) {
          exhaustedValidationFailure = lastValidationFailure;
        }
        const details: SubmitOutputDetails = {
          captured: false,
          callCount,
          invalidCallCount,
          maxSubmitValidationRetries,
          error: 'output_validation_failed',
        };
        recordTaskOutputParseResult({
          taskType,
          model: opts.model,
          code: 'output_validation_failed',
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
          details,
          isError: true,
        };
      }

      captured = candidateParams as Record<string, unknown>;
      callCount += 1;
      const details: SubmitOutputDetails = {
        captured: true,
        callCount,
        error: null,
      };
      return {
        content: [
          {
            type: 'text' as const,
            text:
              'Output captured. The runtime now has the validated payload; ' +
              'no further action is needed for output reporting.',
          },
        ],
        details,
      };
    },
  }) as ToolDefinition<any, any>;

  return {
    tool,
    toolName: contract.toolName,
    getCaptured: () => captured,
    getCallCount: () => callCount,
    getInvalidCallCount: () => invalidCallCount,
    getLastValidationFailure: () => lastValidationFailure,
    getExhaustedValidationFailure: () => exhaustedValidationFailure,
  };
}

/**
 * Build the submit-tool wiring for one task attempt. Returns a handle
 * (or `null` if no submit-tool should be registered) plus the
 * `customTools`-shaped array ready to spread into the session config.
 *
 * The catch is **narrowed** to `UnknownTaskTypeForSubmitToolError` —
 * exporters/dependency-API drift would otherwise be silently degraded
 * to parser-only behaviour, which reintroduces the failure mode this
 * change is fixing. Any other error from the factory propagates.
 */
export function resolveSubmitTools(
  taskType: string,
  opts: CreateSubmitOutputToolOptions = {},
): {
  handle: SubmitOutputToolHandle | null;
  tools: ToolDefinition<any, any>[];
} {
  let handle: SubmitOutputToolHandle | null;
  try {
    handle = createSubmitOutputTool(taskType, opts);
  } catch (err) {
    if (err instanceof UnknownTaskTypeForSubmitToolError) {
      handle = null;
    } else {
      throw err;
    }
  }
  return {
    handle,
    tools: handle ? [handle.tool] : [],
  };
}
