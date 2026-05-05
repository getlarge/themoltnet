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
 *      (see `@mariozechner/pi-agent-core` `agent-loop.ts:208,512`) and
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
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import type { TSchema } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { getTaskOutputSchema } from '@themoltnet/agent-runtime';

interface SubmitOutputDetails {
  captured: boolean;
  callCount: number;
  error: string | null;
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

export function createSubmitOutputTool(
  taskType: string,
): SubmitOutputToolHandle {
  const maybeSchema = getTaskOutputSchema(taskType);
  if (!maybeSchema) {
    throw new Error(
      `createSubmitOutputTool: no output schema registered for task type "${taskType}"`,
    );
  }
  // Bind to a non-nullable local so the inner `execute` closure sees the
  // narrowed TSchema instead of `TSchema | null`.
  const schema: TSchema = maybeSchema;

  const toolName = `submit_${taskType}_output`;
  let captured: Record<string, unknown> | null = null;
  let callCount = 0;

  const tool = defineTool({
    name: toolName,
    label: `Submit ${taskType} output`,
    description:
      `Submit the structured output for this ${taskType} task. ` +
      'Call exactly once when done. Args are validated against the task ' +
      "type's output schema; invalid args return a tool error you can " +
      'retry. The runtime captures the validated payload — you do not need ' +
      'to repeat the JSON in your final assistant message.',
    parameters: Type.Object(
      {
        output: Type.Unknown({
          description:
            `The structured output payload matching the task type's ` +
            'output schema. Pass the full object as a single argument.',
        }),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params) {
      const candidate = (params as { output: unknown }).output;
      const errors = [...Value.Errors(schema, candidate)];
      if (errors.length > 0) {
        const detailMsg = errors
          .slice(0, 3)
          .map((err) => `${err.path || '<root>'}: ${err.message}`)
          .join('; ');
        const details: SubmitOutputDetails = {
          captured: false,
          callCount,
          error: 'output_validation_failed',
        };
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Output failed schema validation: ${detailMsg}. ` +
                'Re-call this tool with a corrected output.',
            },
          ],
          details,
          isError: true,
        };
      }

      captured = candidate as Record<string, unknown>;
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
