/**
 * How an executor delivers a context entry to its underlying LLM.
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

/**
 * One context entry. Bytes are inlined: the imposer chose them, and the
 * task's `inputCid` already pins the entire input — including
 * `context[]` — so we don't need a separate per-entry hash, fetcher, or
 * flagged-content gate. Tasks reference rendered packs (or any other
 * external content) by copying their bytes into `content` at task
 * creation time.
 *
 * - `slug` — short identifier the daemon uses to disambiguate
 *            entries. For `skill` binding it becomes the directory
 *            name under the runtime's skill discovery path. Must be
 *            kebab-case-safe (alphanumeric + dashes/underscores).
 * - `binding` — how the bytes are delivered to the LLM (see above).
 * - `content` — the actual bytes (UTF-8 text). Capped at 64 KiB per
 *               entry; total per-task context bytes are bounded by the
 *               soft `maxItems` cap and per-binding daemon limits.
 *               Raised from 32 KiB in 2026-05 — protocol-heavy operator
 *               skills (e.g. `.claude/skills/legreffier/SKILL.md`) ship
 *               at ~35 KiB inline, and the original cap was sized for
 *               short example skills, not the kind of skill the eval
 *               substrate is dogfooded on (#943, #823).
 */
export const ContextRef = Type.Object(
  {
    slug: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: '^[a-zA-Z0-9_-]+$',
    }),
    binding: ContextBinding,
    content: Type.String({ minLength: 1, maxLength: 65_536 }),
  },
  { $id: 'ContextRef', additionalProperties: false },
);
export type ContextRef = Static<typeof ContextRef>;

/** Reusable input fragment for any task type. Soft cap at 5 items. */
export const TaskContext = Type.Array(ContextRef, {
  $id: 'TaskContext',
  maxItems: 5,
});
export type TaskContext = Static<typeof TaskContext>;
