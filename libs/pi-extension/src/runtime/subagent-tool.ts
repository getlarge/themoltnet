/**
 * Generic `subagent` custom tool for opt-in task types (#1087).
 *
 * Lets the parent LLM delegate sub-tasks to isolated child sessions
 * with named output contracts:
 *
 *   subagent({ task: "...", output_schema: "judge_eval_variant_result" })
 *
 * Each invocation creates a fresh `AgentSession.inMemory()` via
 * `buildAgentSession` that shares the parent's VM, model, and
 * inherited custom tools (Gondolin-routed built-ins plus
 * the moltnet_* tools), but with:
 *
 *   - its own conversation history (no parent context bias)
 *   - its own runtime instructor (parent's verbatim, plus a "you are
 *     a subagent" preamble — invariants like gh-auth and diary
 *     discipline still apply IF the subagent does anything that
 *     would normally trigger them)
 *   - its own submit-tool, `submit_subagent_output`, whose schema is
 *     resolved from the contract name via the injected registry
 *
 * Failure modes (each surfaced as `isError: true` to the parent so
 * the parent LLM can recover mid-conversation):
 *
 *   - Unknown `output_schema` name → tool error.
 *   - Subagent submit-tool args fail schema validation → tool error
 *     (but the inner session may have already retried).
 *   - Subagent never submits before its session terminates → tool
 *     error reporting how the session ended (`stopReason`).
 *
 * The subagent does NOT itself have access to the `subagent` tool
 * (no nested delegation in v1) — the inherited tools list passed
 * here MUST be filtered by the caller.
 */
import type { Api, Model } from '@earendil-works/pi-ai';
import type {
  AgentSession,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SubagentContractRegistry } from '@themoltnet/agent-runtime';
import { type Static, type TObject, Type } from 'typebox';
import { Value } from 'typebox/value';

import {
  buildAgentSession as defaultBuildAgentSession,
  type BuildAgentSessionArgs,
} from './agent-session-factory.js';
import type { PiThinkingLevel } from './pi-thinking-level.js';

const SUBAGENT_SUBMIT_TOOL_NAME = 'submit_subagent_output';
const DEFAULT_SUBAGENT_SUBMIT_VALIDATION_RETRIES = 2;
const RecoverableSubagentSubmitParameters = Type.Object(
  {},
  { additionalProperties: Type.Unknown() },
);

/**
 * Parameters shape the parent LLM sees when calling the subagent tool.
 *
 *   - `task`         — natural-language instructions for the subagent.
 *                      The parent authors this per call. Must be
 *                      non-empty.
 *   - `output_schema` — name of a registered SubagentOutputContract.
 *                      Resolved at call time; unknown names error.
 */
export const SubagentToolParameters = Type.Object(
  {
    task: Type.String({
      minLength: 1,
      description:
        'Natural-language instructions for the subagent. The subagent ' +
        'starts with a fresh conversation and a narrowed system prompt; ' +
        'this is the only context it has from you.',
    }),
    output_schema: Type.String({
      minLength: 1,
      description:
        'Name of a registered subagent output contract. The subagent ' +
        'must submit a structured payload via `submit_subagent_output` ' +
        'matching this contract.',
    }),
  },
  { additionalProperties: false },
);
export type SubagentToolParameters = Static<typeof SubagentToolParameters>;

export interface CreateSubagentToolArgs {
  /** Host directory mounted into the VM. */
  mountPath: string;
  /** Host working directory the subagent should start in. Defaults to mountPath. */
  cwdPath?: string;
  /** pi auth directory the parent resolved. */
  piAuthDir: string;
  /** Resolved pi model handle — subagents share it. */
  modelHandle: Model<Api>;
  /** Runtime-profile thinking/reasoning level — subagents inherit it. */
  thinkingLevel?: PiThinkingLevel | null;
  /** Runtime-profile sampling temperature — subagents inherit it. */
  temperature?: number | null;
  /** Runtime-profile nucleus sampling probability mass — subagents inherit it. */
  topP?: number | null;
  /** Runtime-profile top-k sampling cutoff — subagents inherit it. */
  topK?: number | null;
  /** Runtime-profile generated output token cap — subagents inherit it. */
  maxOutputTokens?: number | null;
  /** Agent name for telemetry. */
  agentName: string;
  /**
   * Custom tools every subagent inherits (Gondolin-routed
   * built-ins + moltnet_* tools, etc). MUST NOT include
   * the parent's submit-output tool, the parent's `subagent` tool,
   * or any other parent-only artefact — the caller is responsible
   * for filtering. The subagent appends its own submit tool.
   */
  inheritedCustomTools: ToolDefinition[];
  /**
   * The parent runtime instructor verbatim. Subagents prepend it to
   * their own short "you are a subagent" preamble so the same
   * invariants (gh auth, diary discipline, accountable commits)
   * apply if the subagent takes those actions. The parent's task
   * description dictates whether they should.
   */
  parentRuntimeInstructor: string;

  // Telemetry — copied verbatim onto subagent OTel spans so traces
  // can be filtered by parent task. The subagent ALSO gets its own
  // attrs (contract name + call index) layered on top.
  parentTaskId: string;
  parentTaskType: string;
  parentAttemptN: number;

  /**
   * Parent task's cancel signal. When the daemon cancels the parent
   * task (operator cancel or task-level `runningTimeoutSec` expiry),
   * each in-flight subagent's inner `session.abort()` is invoked so
   * it tears down promptly instead of running until its own LLM
   * call resolves. Mirrors the existing `wireSessionAbort` pattern
   * the parent session uses.
   *
   * Optional only because the test seam can omit it; production
   * callers (executePiTask) pass `reporter.cancelSignal`.
   */
  parentCancelSignal?: AbortSignal;

  /**
   * Per-call fallback timeout. Defends against an inner session that
   * ignores `abort()` for any reason (LLM provider stuck, tool call
   * hanging on I/O, etc.). When the timeout fires, `session.abort()`
   * is invoked and the tool returns `isError: true` with a
   * `subagent_timed_out` reason the parent LLM can recover from.
   *
   * Default: 5 minutes. Set to `0` to disable (relying purely on
   * parentCancelSignal). Negative values are treated as the default.
   */
  timeoutMs?: number;

  /**
   * Test seam. Production callers leave this undefined and get
   * `buildAgentSession` from the factory module. Tests inject a mock
   * that returns a stub session implementing only `prompt()` to
   * exercise the tool's logic without booting a VM.
   */
  buildAgentSession?: (args: BuildAgentSessionArgs) => Promise<AgentSession>;

  /**
   * Contract registry for resolving output_schema names to TypeBox
   * schemas at call time. The subagent tool reads ONLY via `.get()`
   * and `.list()` — the registry is immutable after construction.
   *
   * Production callers (executePiTask) create the registry with
   * built-in contracts at session-setup; tests inject a registry
   * with whatever stubs they need.
   */
  contractRegistry: SubagentContractRegistry;
}

const DEFAULT_SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

export interface SubagentToolHandle {
  /** ToolDefinition to register via `customTools` on the parent session. */
  readonly tool: ToolDefinition;
  /** How many times the parent LLM has called this tool. */
  getCallCount: () => number;
}

/**
 * Build the subagent custom tool for a parent session. The handle
 * exposes the call counter so executors can emit summary telemetry
 * when the parent terminates.
 */
export function createSubagentTool(
  args: CreateSubagentToolArgs,
): SubagentToolHandle {
  const buildSession = args.buildAgentSession ?? defaultBuildAgentSession;
  const { contractRegistry } = args;
  let callCount = 0;

  const tool = defineTool({
    name: 'subagent',
    label: 'Delegate to subagent',
    description: subagentToolDescription(),
    parameters: SubagentToolParameters as TObject,
    async execute(_id, params) {
      // Belt-and-braces parameter validation — defineTool already
      // validates against the schema, but if the SDK ever loosens that
      // we want a clear failure here rather than a downstream surprise.
      if (!Value.Check(SubagentToolParameters, params)) {
        return toolError(
          `subagent: invalid parameters: ${JSON.stringify(
            [...Value.Errors(SubagentToolParameters, params)].slice(0, 3),
          )}`,
        );
      }

      const { task, output_schema } = params;
      const contract = contractRegistry.get(output_schema);
      if (!contract) {
        const known = contractRegistry
          .list()
          .map((c) => c.name)
          .join(', ');
        return toolError(
          `subagent: unknown output_schema "${output_schema}". ` +
            `Registered contracts: [${known}]`,
        );
      }

      callCount += 1;
      const callIndex = callCount;

      // Build the subagent's own submit tool — a one-shot capture
      // closure validated against the resolved contract. Mirrors the
      // submit-output-tool pattern used for parent sessions.
      let captured: Record<string, unknown> | null = null;
      let innerInvalidSubmitCount = 0;
      let innerValidationFailure: string | null = null;
      let innerValidationExhausted = false;
      const submitTool = defineTool({
        name: SUBAGENT_SUBMIT_TOOL_NAME,
        label: `Submit ${output_schema}`,
        description:
          `Submit your structured output for this subagent task. ` +
          `Call exactly once when done. Args MUST match the ` +
          `${output_schema} contract; mismatches return a tool error ` +
          'you can recover from in the same session.',
        promptSnippet:
          `${SUBAGENT_SUBMIT_TOOL_NAME}: submit the final structured ` +
          `${output_schema} payload.`,
        promptGuidelines: [
          `Call \`${SUBAGENT_SUBMIT_TOOL_NAME}\` with the exact \`${output_schema}\` contract shape.`,
          'If the submit tool returns a validation error, fix every listed field and call the same tool again.',
        ],
        parameters: RecoverableSubagentSubmitParameters as TObject,
        async execute(_innerId, innerParams) {
          if (!Value.Check(contract.parametersSchema, innerParams)) {
            innerInvalidSubmitCount += 1;
            const maxInvalidCalls =
              DEFAULT_SUBAGENT_SUBMIT_VALIDATION_RETRIES + 1;
            const exhausted = innerInvalidSubmitCount >= maxInvalidCalls;
            const errs = [
              ...Value.Errors(contract.parametersSchema, innerParams),
            ]
              .map((e) => `${e.instancePath}: ${e.message}`)
              .join('; ');
            innerValidationFailure =
              `submit_subagent_output validation failed ` +
              `(${innerInvalidSubmitCount}/${maxInvalidCalls}): ${errs}. ` +
              (exhausted
                ? 'Validation retry budget exhausted.'
                : 'Re-call with a corrected payload.');
            if (exhausted) {
              innerValidationExhausted = true;
            }
            return toolError(innerValidationFailure, {
              captured: false,
              error: 'output_validation_failed',
              invalidCallCount: innerInvalidSubmitCount,
              maxSubmitValidationRetries:
                DEFAULT_SUBAGENT_SUBMIT_VALIDATION_RETRIES,
            });
          }
          captured = innerParams as Record<string, unknown>;
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  'Output captured. No further action needed for ' +
                  'subagent output reporting.',
              },
            ],
            details: { captured: true },
          };
        },
      });

      // Subagent system prompt = parent's runtime instructor + a small
      // preamble that scopes the role and points at the submit tool.
      const subagentInstructor = buildSubagentInstructor({
        contractName: output_schema,
        contractDescription: contract.description,
        parentTaskId: args.parentTaskId,
        callIndex,
      });

      const session = await buildSession({
        mountPath: args.mountPath,
        cwdPath: args.cwdPath ?? args.mountPath,
        piAuthDir: args.piAuthDir,
        modelHandle: args.modelHandle,
        thinkingLevel: args.thinkingLevel,
        temperature: args.temperature,
        topP: args.topP,
        topK: args.topK,
        maxOutputTokens: args.maxOutputTokens,
        agentName: args.agentName,
        customTools: [...args.inheritedCustomTools, submitTool],
        appendSystemPrompt: [args.parentRuntimeInstructor, subagentInstructor],
        // No injected skills for subagents — they get only what their
        // task description tells them.
        skillsOverride: () => ({ skills: [], diagnostics: [] }),
        otelSpanAttrs: {
          'moltnet.task.id': args.parentTaskId,
          'moltnet.task.type': args.parentTaskType,
          'moltnet.task.attempt': args.parentAttemptN,
          'moltnet.subagent.contract': output_schema,
          'moltnet.subagent.index': callIndex,
        },
      });

      // Wire parent-cancel and per-call timeout to inner session.abort().
      // pi's PromptOptions has no `signal` field (as of 0.74), so we
      // mirror the parent-session pattern: register listeners that
      // call `session.abort()` and let it propagate through the
      // streaming LLM response. Whichever fires first wins; both
      // record their reason for the post-prompt error path.
      let abortReason: 'parent_cancelled' | 'subagent_timed_out' | null = null;
      let abortInvoked = false;
      const fireAbort = (reason: typeof abortReason): void => {
        if (abortInvoked) return;
        abortInvoked = true;
        abortReason = reason;
        session.abort().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[subagent] inner session.abort() failed: ${message}\n`,
          );
        });
      };

      const cancelListener = args.parentCancelSignal
        ? (() => {
            const signal = args.parentCancelSignal;
            const listener = () => fireAbort('parent_cancelled');
            if (signal.aborted) {
              listener();
            } else {
              signal.addEventListener('abort', listener, { once: true });
            }
            return () => signal.removeEventListener('abort', listener);
          })()
        : null;

      const timeoutMs =
        args.timeoutMs === undefined || args.timeoutMs < 0
          ? DEFAULT_SUBAGENT_TIMEOUT_MS
          : args.timeoutMs;
      const timeoutHandle =
        timeoutMs > 0
          ? setTimeout(() => fireAbort('subagent_timed_out'), timeoutMs)
          : null;

      try {
        await session.prompt(task);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return toolError(`subagent: inner session.prompt() threw: ${message}`);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (cancelListener) cancelListener();
      }

      if (abortReason !== null) {
        // Capture may or may not be set depending on whether the inner
        // submit landed before abort; we always surface the abort as a
        // recoverable tool error so the parent can decide to retry vs.
        // fail the task.
        const reasonText =
          abortReason === 'subagent_timed_out'
            ? `subagent timed out after ${timeoutMs}ms`
            : 'parent task was cancelled';
        return toolError(
          `subagent: ${reasonText}. The parent should fail this task or ` +
            'retry with a clearer scope.',
        );
      }

      if (captured === null) {
        const exhaustedFailure = innerValidationFailure as string | null;
        if (innerValidationExhausted && exhaustedFailure) {
          return toolError(`subagent: ${exhaustedFailure}`, {
            captured: false,
            error: 'output_validation_failed',
            invalidCallCount: innerInvalidSubmitCount,
            maxSubmitValidationRetries:
              DEFAULT_SUBAGENT_SUBMIT_VALIDATION_RETRIES,
          });
        }
        return toolError(
          `subagent: inner session ended without calling ${SUBAGENT_SUBMIT_TOOL_NAME}. ` +
            'The parent should retry with clearer instructions or ' +
            'fail the task.',
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(captured),
          },
        ],
        details: {
          captured: true,
          contract: output_schema,
          callIndex,
        },
      };
    },
  }) as ToolDefinition;

  return {
    tool,
    getCallCount: () => callCount,
  };
}

function subagentToolDescription(): string {
  return [
    'Delegate a sub-task to a fresh subagent session with isolated context.',
    '',
    'The subagent starts with no conversation history and only the `task` ',
    'string you provide as its instructions. It runs in the same VM with ',
    'the same tools you have (Gondolin-routed built-ins, ',
    'moltnet_* tools), and is expected to call ',
    `\`${SUBAGENT_SUBMIT_TOOL_NAME}\` with a payload matching the named `,
    'contract before its session ends.',
    '',
    'On success, the tool result is the JSON-stringified subagent payload.',
    'On failure (unknown contract, validation error, subagent did not ',
    'submit) the tool returns isError:true with a recoverable message.',
  ].join('\n');
}

function buildSubagentInstructor(args: {
  contractName: string;
  contractDescription: string;
  parentTaskId: string;
  callIndex: number;
}): string {
  return [
    '# You are a subagent',
    '',
    `Parent task: \`${args.parentTaskId}\` (subagent call #${args.callIndex}).`,
    '',
    `Your assigned output contract is \`${args.contractName}\`:`,
    `${args.contractDescription}`,
    '',
    'Rules for this session:',
    '',
    `- You MUST call \`${SUBAGENT_SUBMIT_TOOL_NAME}\` exactly once with a `,
    '  payload matching the contract above as your final task action.',
    "- The parent's message above is your task. Do not invent additional ",
    '  steps the parent did not request.',
    '- All MoltNet runtime invariants from the parent runtime instructor ',
    '  apply (diary discipline, gh-auth pattern, etc.) IF you take any ',
    '  action that would trigger them. Most subagents do not commit code ',
    '  or open PRs — only do so if your task message explicitly requires it.',
    '- You do NOT have access to the `subagent` tool. Do not attempt nested ',
    '  delegation; do the work yourself.',
  ].join('\n');
}

function toolError(
  text: string,
  details: Record<string, unknown> = { captured: false },
) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
    isError: true,
  };
}
