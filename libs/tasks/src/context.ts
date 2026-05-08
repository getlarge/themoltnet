/**
 * How an executor delivers a context CID to its underlying LLM.
 * V1 bindings only; Tier-2 (reference_file, mcp_resource, imported_file,
 * tool_response_seed, additional_context_hook) ship in a later slice.
 */
import { type Static, Type } from '@sinclair/typebox';

export const ContextBinding = Type.Union(
  [
    Type.Literal('skill'),
    Type.Literal('prompt_prefix'),
    Type.Literal('user_inline'),
  ],
  { $id: 'ContextBinding' },
);
export type ContextBinding = Static<typeof ContextBinding>;

export const ContextRef = Type.Object(
  {
    cid: Type.String({ minLength: 1 }),
    binding: ContextBinding,
  },
  { $id: 'ContextRef', additionalProperties: false },
);
export type ContextRef = Static<typeof ContextRef>;

/**
 * Reusable input fragment for any task type. Soft cap at 5 items;
 * per-VM total bytes enforced at injection time by the daemon.
 */
export const TaskContext = Type.Array(ContextRef, {
  $id: 'TaskContext',
  maxItems: 5,
});
export type TaskContext = Static<typeof TaskContext>;
