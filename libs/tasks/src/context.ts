/**
 * How an executor delivers a context entry to its underlying LLM.
 * V1 bindings only; Tier-2 (reference_file, mcp_resource, imported_file,
 * tool_response_seed, additional_context_hook) ship in a later slice.
 */
import { Type } from 'typebox';

export const CONTEXT_BINDINGS = [
  'skill',
  'context_inline',
  'prompt_prefix',
  'user_inline',
] as const;
export type ContextBinding = (typeof CONTEXT_BINDINGS)[number];

/** Maximum UTF-16 code units accepted in one ContextRef content field. */
export const CONTEXT_REF_MAX_CONTENT_LENGTH = 65_536;

export const ContextBinding = Type.Unsafe<ContextBinding>(
  Type.Union(
    CONTEXT_BINDINGS.map((binding) => Type.Literal(binding)),
    {
      $id: 'ContextBinding',
    },
  ),
);

/**
 * One context entry. Bytes are inlined: the proposer chose them, and the
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
 * - `content` — UTF-8 text. Capped at 65,536 UTF-16 code units per
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
    content: Type.String({
      minLength: 1,
      maxLength: CONTEXT_REF_MAX_CONTENT_LENGTH,
    }),
  },
  { $id: 'ContextRef', additionalProperties: false },
);
export type ContextRef = {
  slug: string;
  binding: ContextBinding;
  content: string;
};

/** Reusable input fragment for any task type. Soft cap at 5 items. */
export const TaskContext = Type.Array(ContextRef, {
  $id: 'TaskContext',
  maxItems: 5,
});
export type TaskContext = ContextRef[];
