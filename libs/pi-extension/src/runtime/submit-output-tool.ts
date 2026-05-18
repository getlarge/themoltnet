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
 *      reference exposed via `getCaptured()` and the tool result returns
 *      `terminate: true`. pi-coding-agent's agent-loop reads that flag
 *      (see `@earendil-works/pi-agent-core` `agent-loop.ts:208,512`) and
 *      ends the session immediately — no follow-up LLM turn, no extra
 *      tokens spent narrating "ok, done."
 *
 *   3. If the model somehow calls the tool more than once before
 *      termination resolves, the latest valid call wins. This matches
 *      "submit exactly once" semantics from the prompt while staying
 *      defensive against retries.
 *
 * The model still has to *decide* to call the tool — pi-coding-agent's
 * `AgentLoopConfig` does not expose `toolChoice`, so we cannot force the
 * call. The strict closing block in the system prompt (commit 1 of this
 * PR) carries that weight.
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { TObject } from '@sinclair/typebox';
import {
  getSubmitOutputContract,
  validateTaskOutput,
} from '@themoltnet/agent-runtime';

import { recordTaskOutputParseResult } from './task-output.js';

interface SubmitOutputDetails {
  captured: boolean;
  callCount: number;
  error: string | null;
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
   * input.successCriteria exists") are enforced before the session can
   * terminate.
   */
  input?: unknown;
}

export interface SubmitOutputToolHandle {
  /** ToolDefinition to register via `customTools` on the agent session. */
  tool: ToolDefinition<any, any>;
  /**
   * Latest validated payload submitted by the model, or `null` if the
   * model never produced a valid call. Read after `session.prompt()`
   * resolves — the executor prefers this over `parseStructuredTaskOutput`.
   */
  getCaptured: () => Record<string, unknown> | null;
  /** Number of times the model called the tool with valid args. */
  getCallCount: () => number;
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
  // Every built-in *Output schema is `Type.Object`. Cast to TObject so
  // it can ride straight through as the tool's `parameters` schema —
  // pi/TypeBox tool parameters require an object at the top level. If a
  // future task type registers a non-object output schema this cast
  // will surface as a runtime error in `defineTool`, which is the
  // correct failure mode (loud, not silent).
  const schema = contract.parametersSchema as TObject;

  let captured: Record<string, unknown> | null = null;
  let callCount = 0;

  const tool = defineTool({
    name: contract.toolName,
    label: `Submit ${taskType} output`,
    description: contract.description,
    parameters: schema,
    async execute(_id, params) {
      // Use the registry-aware validator: runs the TypeBox schema check
      // AND any task-type-specific cross-field rule (e.g. judge_pack's
      // `llm_checklist` score↔assertions consistency from #999). Without
      // the cross-field pass, an LLM that submits `score: 1` alongside a
      // failing assertion sails through here and the bad payload
      // pollutes attestations. Returning isError:true lets the agent
      // re-call with a corrected payload mid-session — same recovery
      // affordance as a plain schema miss.
      const errors = validateTaskOutput(taskType, params, opts.input);
      if (errors.length > 0) {
        const detailMsg = errors
          .slice(0, 3)
          .map((err) => `${err.field}: ${err.message}`)
          .join('; ');
        const details: SubmitOutputDetails = {
          captured: false,
          callCount,
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
              text:
                `Output failed validation: ${detailMsg}. ` +
                'Re-call this tool with a corrected output.',
            },
          ],
          details,
          isError: true,
        };
      }

      captured = params as Record<string, unknown>;
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
        terminate: true,
      };
    },
  }) as ToolDefinition<any, any>;

  return {
    tool,
    getCaptured: () => captured,
    getCallCount: () => callCount,
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
