/**
 * Submit-output tool contract.
 *
 * The runtime advertises a per-task-type "submit output" tool in every
 * prompt. The tool's name and schema must be the same wherever the
 * agent encounters it: in the system prompt the model reads, in the
 * executor that registers it, in any future executor that wires it
 * into a different coding-agent SDK.
 *
 * This module is the single source of truth for the (toolName,
 * description, parametersSchema) triple. It has no executor-specific
 * dependencies — `agent-runtime` is intentionally agnostic of the
 * concrete coding-agent runtime — so anything that wants to register
 * the tool (pi-extension today, a Codex-SDK adapter tomorrow, a local
 * MCP bridge if we ever go that route) can read the contract here and
 * wire it into its own tool API.
 *
 * Conventions captured here:
 *
 *   - Tool name shape: `submit_<task_type>_output` (e.g.
 *     `submit_fulfill_brief_output`). This is the string the model
 *     sees in the prompt's "preferred path" instruction.
 *   - Parameters schema: the task type's submission shape **directly**,
 *     NOT wrapped in `{ output: <schema> }`. TypeBox `$id` annotations are
 *     removed from the advertised JSON Schema; runtime validation retains
 *     the original task schema. Tool args
 *     ARE the agent-authored payload. Executor-observed fields are stamped
 *     after submission and never requested from the model.
 *   - Description text: shared across executors so the tool's
 *     advertised purpose is identical regardless of who registers it.
 */
import type { TSchema } from 'typebox';

import { getAgentSubmissionSchema } from './output-contract.js';

export interface SubmitOutputContract {
  /** Concrete tool name the executor must register — e.g.
   * `submit_fulfill_brief_output`. */
  toolName: string;
  /**
   * The task type the contract is for. Useful for executor code that
   * needs to label metrics or build dispatch tables.
   */
  taskType: string;
  /** Human-readable description shown to the model and any UI that
   * lists registered tools. */
  description: string;
  /** JSON Schema the tool's `parameters` MUST advertise. It preserves the
   * task submission shape but omits TypeBox-only `$id` annotations. */
  parametersSchema: TSchema;
  /** Stable JSON rendering the executor must make visible to the model. */
  parametersSchemaJson: string;
}

/**
 * Build the submit-output contract for a task type. Returns `null` if
 * no output schema is registered for that type. Executors require a schema.
 */
export function getSubmitOutputContract(
  taskType: string,
  input?: unknown,
): SubmitOutputContract | null {
  const taskSchema = getAgentSubmissionSchema(taskType, input);
  if (!taskSchema) return null;
  const schema = stripSchemaIds(taskSchema);

  return {
    toolName: submitOutputToolName(taskType),
    taskType,
    description:
      `Submit the structured output for this ${taskType} task. ` +
      'Call exactly once when done. The arguments below ARE the agent-authored ' +
      "payload — pass each top-level field of the task type's submission " +
      'schema directly. The runtime validates the args against the ' +
      'schema; mismatches return a tool error you can recover from in ' +
      'the same session. On a valid call the runtime captures the ' +
      'payload for attempt completion — you do not need to repeat the ' +
      'JSON in your final assistant message.',
    parametersSchema: schema,
    parametersSchemaJson: JSON.stringify(schema, null, 2),
  };
}

/** `$id` names TypeBox definitions; it does not constrain tool arguments.
 * Codex strict function tools can terminate before generation when nested
 * `$id` metadata is included. Keep the task schema intact for validation. */
function stripSchemaIds<T>(value: T, propertyMap = false): T {
  if (Array.isArray(value))
    return (value as unknown[]).map((child) => stripSchemaIds(child)) as T;
  if (value !== null && typeof value === 'object') {
    const copy = { ...value } as Record<string, unknown>;
    // In `properties`, keys are user field names rather than schema keywords.
    if (!propertyMap) delete copy.$id;
    for (const [key, child] of Object.entries(copy)) {
      copy[key] = stripSchemaIds(child, !propertyMap && key === 'properties');
    }
    return copy as T;
  }
  return value;
}

/**
 * Plain-string name builder. Exposed separately so the prompt builder
 * can advertise the tool name even when the schema lookup is deferred
 * to the executor (the prompt is built before any tool registration
 * happens).
 */
export function submitOutputToolName(taskType: string): string {
  return `submit_${taskType}_output`;
}
