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
 *      captured state after `session.prompt()` resolves. An optional
 *      executor-owned callback ends the live session; tool-result properties
 *      are not session control flow in Pi.
 *
 *   3. If the model somehow calls the tool more than once, the first valid
 *      call remains immutable. This defends against retries while preserving
 *      "submit exactly once" semantics.
 *
 * The model still has to *decide* to call the tool — pi-coding-agent's
 * `AgentLoopConfig` does not expose `toolChoice`, so we cannot force the
 * call. The strict closing block in the system prompt (commit 1 of this
 * PR) carries that weight.
 */
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SchemaAlignmentRepair } from '@themoltnet/agent-runtime';
import {
  alignToSchema,
  getSubmitOutputContract,
  SUBMIT_OUTPUT_GATE_ID,
  validateAgentTaskSubmission,
} from '@themoltnet/agent-runtime';
import { type TObject, type TSchema } from 'typebox';

import { recordTaskOutputParseResult } from './task-output.js';

interface SubmitOutputDetails {
  captured: boolean;
  callCount: number;
  error: string | null;
  invalidCallCount?: number;
}

export interface CreateSubmitOutputToolOptions {
  /**
   * Optional model identifier for the OTel counter labels. Mirrors the
   * `output_validation_failed` observations carry `{task_type, model}` labels.
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
   * Executor-owned completion boundary invoked after the first valid capture.
   * The Gondolin/Pi executor uses this to abort the live session cleanly.
   */
  onValidCapture?: () => void | Promise<void>;
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
   * resolves.
   */
  getCaptured: () => Record<string, unknown> | null;
  /** Number of times the model called the tool with valid args. */
  getCallCount: () => number;
  /** Number of invalid submit calls observed in this session. */
  getInvalidCallCount: () => number;
  /** Last validation failure, if the model submitted invalid args. */
  getLastValidationFailure: () => { code: string; message: string } | null;
  /** Normalizations applied to the accepted submit call; contains no payload. */
  getCapturedRepairKinds: () => string[];
  getCapturedRepairs: () => SchemaAlignmentRepair[];
}

/**
 * Sentinel thrown when the requested task type has no registered output
 * schema. The executor cannot run a task without a registered output schema.
 */
export class UnknownTaskTypeForSubmitToolError extends Error {
  constructor(public readonly taskType: string) {
    super(
      `createSubmitOutputTool: no output schema registered for task type "${taskType}"`,
    );
    this.name = 'UnknownTaskTypeForSubmitToolError';
  }
}

/**
 * Pi validates tool arguments before execute() runs. The exact task schema is
 * sent to the provider; this check also keeps top-level decoding bounded to
 * known properties when a provider stringifies JSON values.
 */
function requireObjectSchema(schema: TSchema): TObject {
  if (
    !('type' in schema) ||
    schema.type !== 'object' ||
    !('properties' in schema)
  ) {
    throw new Error('Submit-output schemas must be top-level objects');
  }
  return schema as unknown as TObject;
}

function formatValidationErrors(
  errors: ReturnType<typeof validateAgentTaskSubmission>,
): string {
  return errors.map((err) => `${err.field}: ${err.message}`).join('; ');
}

function submitOutputRepairHint(
  taskType: string,
  errors: ReturnType<typeof validateAgentTaskSubmission>,
  schema: TSchema,
): string {
  const fields = new Set(errors.map((err) => err.field));
  const hints: string[] = [
    'Tool args must be the output object directly, not wrapped in { output: ... }.',
  ];
  const objectSchema = requireObjectSchema(schema);
  const required = Array.isArray(objectSchema.required)
    ? objectSchema.required.filter(
        (field): field is string => typeof field === 'string',
      )
    : [];
  if (required.length > 0) {
    hints.push(`Required top-level fields: ${required.join(', ')}.`);
  }

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

  if (fields.has('output/artifacts') || fields.has('output/verification')) {
    if (taskType === 'freeform' && required.includes('result')) {
      hints.push(
        'For this contracted freeform retry, preserve the required `result` and ensure it satisfies the advertised result schema while correcting artifacts and verification.',
      );
    } else if (taskType === 'freeform') {
      hints.push(
        'Minimal valid freeform retry: { "summary": "completed", "artifacts": [], "verification": { "inputCid": "<task inputCid>", "results": [{ "id": "submit-output", "kind": "gate", "status": "pass", "detail": "submit_freeform_output accepted valid args" }], "passed": true } }.',
      );
    } else {
      hints.push(
        `\`verification\` is a stamp when the only gate is submit-output: { "inputCid": "<task inputCid>", "results": [{ "id": "submit-output", "kind": "gate", "status": "pass", "detail": "submit_${taskType}_output accepted valid args" }], "passed": true }.`,
      );
    }
  }

  if (hints.length === 1) {
    hints.push('Fix every listed field before re-calling this same tool.');
  }

  return hints.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Only the auto-injected submit-output gate may be verified mechanically.
 */
function onlySubmitOutputGate(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.successCriteria)) return false;
  const criteria = input.successCriteria;
  const gates = criteria.gates;
  if (!Array.isArray(gates) || gates.length !== 1) return false;
  const [gate] = gates as unknown[];
  if (!isRecord(gate) || gate.id !== SUBMIT_OUTPUT_GATE_ID) return false;

  const assertions = criteria.assertions;
  if (Array.isArray(assertions) && assertions.length > 0) return false;
  return (
    criteria.rubric === undefined &&
    criteria.sideEffects === undefined &&
    criteria.minComposite === undefined
  );
}

/**
 * Repair a producer submit-output payload when the task's ONLY success gate is
 * the auto-injected submit-output gate — i.e. there is nothing substantive to
 * self-assess, so the `verification` record is a mechanical stamp. Applies to
 * any producer task type (freeform, run_eval, …), not just freeform: weaker
 * models mis-type or omit the nested `verification` object identically across
 * types, and previously only freeform was repaired, so run_eval attempts failed
 * `output_validation_failed` on verification alone. Syntax alignment is
 * handled separately by the shared schema normalizer, and the caller
 * re-validates the stamped payload against the task contract.
 */
function repairProducerSubmitOutput(
  taskType: string,
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

  repaired.verification = {
    inputCid: opts.inputCid,
    results: [
      {
        id: SUBMIT_OUTPUT_GATE_ID,
        kind: 'gate',
        status: 'pass',
        detail: `submit_${taskType}_output accepted valid args`,
      },
    ],
    passed: true,
  };

  return repaired;
}

function normalizeSubmitArguments(
  taskType: string,
  params: unknown,
  schema: TSchema,
  toolName: string,
  description: string,
  opts: CreateSubmitOutputToolOptions,
): { candidate: unknown; repairs: SchemaAlignmentRepair[] } {
  const aligned = alignToSchema(params, schema);
  const repairs = [...aligned.repairs];
  // Producer repair is mechanical for a submit-only gate. Apply it before
  // Pi validation, which removes strict-mode null placeholders. Cross-field
  // task validation runs on Pi's cleaned value in execute().
  const repaired = repairProducerSubmitOutput(taskType, aligned.value, opts);
  const candidate = repaired ?? aligned.value;
  if (repaired && isRecord(aligned.value)) {
    if (
      JSON.stringify(repaired.verification) !==
      JSON.stringify(aligned.value.verification)
    )
      repairs.push({ kind: 'submit_gate_verification', path: '/verification' });
  }
  const piNormalized = validateToolArguments(
    { name: toolName, description, parameters: schema },
    {
      type: 'toolCall',
      id: 'submit-prepare',
      name: toolName,
      arguments: candidate as Record<string, never>,
    },
  ) as Record<string, unknown>;
  if (JSON.stringify(piNormalized) !== JSON.stringify(candidate)) {
    repairs.push({ kind: 'pi_schema_coercion', path: '' });
  }
  return { candidate: piNormalized, repairs };
}

export function createSubmitOutputTool(
  taskType: string,
  opts: CreateSubmitOutputToolOptions = {},
): SubmitOutputToolHandle {
  // The (toolName, description, parametersSchema) triple lives in
  // @themoltnet/agent-runtime so the prompt builder and any executor
  // share one source of truth. pi-extension is the executor; future
  // executors (Codex SDK adapter, etc.) read the same contract.
  const contract = getSubmitOutputContract(taskType, opts.input);
  if (!contract) {
    throw new UnknownTaskTypeForSubmitToolError(taskType);
  }

  let captured: Record<string, unknown> | null = null;
  let callCount = 0;
  let invalidCallCount = 0;
  let lastValidationFailure: { code: string; message: string } | null = null;
  let capturedRepairs: SchemaAlignmentRepair[] = [];
  const preparedRepairs = new Map<string, SchemaAlignmentRepair[]>();

  const schema = contract.parametersSchema;

  const recordInvalidCall = (candidate: unknown, piError?: unknown): string => {
    invalidCallCount += 1;
    const errors = validateAgentTaskSubmission(
      taskType,
      candidate,
      opts.input,
      {
        inputCid: opts.inputCid,
      },
    );
    const detailMsg =
      errors.length > 0
        ? formatValidationErrors(errors)
        : piError instanceof Error
          ? piError.message.split('\n\nReceived arguments:')[0]
          : 'Pi rejected arguments against the advertised tool schema';
    const message =
      `Output failed validation (invalid call ${invalidCallCount}): ` +
      `${detailMsg}. ` +
      `${submitOutputRepairHint(taskType, errors, schema)} ` +
      'Re-call this tool with a corrected output in the current session.';
    lastValidationFailure = { code: 'output_validation_failed', message };
    recordTaskOutputParseResult({
      taskType,
      model: opts.model,
      code: 'output_validation_failed',
    });
    return message;
  };

  const tool = defineTool({
    name: contract.toolName,
    label: `Submit ${taskType} output`,
    description: contract.description,
    promptSnippet:
      `${contract.toolName}: submit the final structured ${taskType} ` +
      'output. Use the agent submission schema below exactly; runtime-owned ' +
      'telemetry fields are not yours to supply.\n\n' +
      `Agent submission schema:\n\`\`\`json\n${contract.parametersSchemaJson}\n\`\`\``,
    promptGuidelines: [
      `Call \`${contract.toolName}\` with the exact ${taskType} agent submission shape shown above.`,
      'If the submit tool returns a validation error, fix every listed field and call the same tool again.',
      'The first valid submission is final and immediately ends the session.',
    ],
    parameters: schema,
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    prepareArguments: (args) => {
      // A later duplicate in the same batch must reach execute()'s immutable
      // captured branch. Pi validates after prepareArguments, so pass the
      // already-valid payload rather than invalid duplicate arguments.
      if (captured) return captured;
      try {
        const normalized = normalizeSubmitArguments(
          taskType,
          args,
          schema,
          contract.toolName,
          contract.description,
          opts,
        );
        const prepared = normalized.candidate as Record<string, unknown>;
        preparedRepairs.set(JSON.stringify(prepared), normalized.repairs);
        return prepared;
      } catch (error) {
        throw new Error(recordInvalidCall(args, error));
      }
    },
    async execute(_id, params) {
      if (captured) {
        const details: SubmitOutputDetails = {
          captured: true,
          callCount,
          invalidCallCount,
          error: null,
        };
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Output was already captured. The first valid payload remains ' +
                'final; this duplicate submission was ignored.',
            },
          ],
          details,
          terminate: true,
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
      const key = JSON.stringify(params);
      const prepared = preparedRepairs.get(key);
      if (prepared) preparedRepairs.delete(key);
      let normalized: { candidate: unknown; repairs: SchemaAlignmentRepair[] };
      try {
        normalized = prepared
          ? { candidate: params, repairs: prepared }
          : normalizeSubmitArguments(
              taskType,
              params,
              schema,
              contract.toolName,
              contract.description,
              opts,
            );
      } catch (error) {
        const message = recordInvalidCall(params, error);
        return {
          content: [{ type: 'text' as const, text: message }],
          details: {
            captured: false,
            callCount,
            invalidCallCount,
            error: 'output_validation_failed',
          },
          isError: true,
        };
      }
      const candidateParams = normalized.candidate;
      const errors = validateAgentTaskSubmission(
        taskType,
        candidateParams,
        opts.input,
        { inputCid: opts.inputCid },
      );
      if (errors.length > 0) {
        const message = recordInvalidCall(candidateParams);
        const details: SubmitOutputDetails = {
          captured: false,
          callCount,
          invalidCallCount,
          error: 'output_validation_failed',
        };
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
      capturedRepairs = normalized.repairs;
      preparedRepairs.clear();
      callCount += 1;
      await opts.onValidCapture?.();
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
        terminate: true,
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
    getCapturedRepairKinds: () => capturedRepairs.map((repair) => repair.kind),
    getCapturedRepairs: () => [...capturedRepairs],
  };
}
