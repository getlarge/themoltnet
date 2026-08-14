import type { ContextPack } from '@moltnet/api-client';

/**
 * How a pack is named in the UI.
 *
 * `ContextPack` has no `name` column, so the heading is derived from `params`.
 * The producer is `libs/agent-runtime/src/prompts/curate-pack.ts`, which writes
 * `{ recipe, prompt, selection_rationale }` — so `prompt` is the human-readable
 * key and `recipe` is a slug worth showing only when no prompt was recorded.
 * `taskPrompt` is checked too because it is the task-input spelling and a
 * hand-written pack may carry it.
 *
 * `params` is `unknown` on the wire: each candidate is type-checked in turn
 * rather than picked by `??`, which would take a non-string first match and
 * discard a valid sibling.
 *
 * This lives beside `decay.ts` in the pack domain layer rather than inside a
 * component: it is a naming rule, not a presentation detail, and the catalog,
 * the detail page, and lineage all need the same answer.
 */
const SUMMARY_KEYS = ['prompt', 'taskPrompt'] as const;

export interface PackSummary {
  text: string;
  derivedFrom: 'prompt' | 'recipe' | 'id';
}

export function packSummary(
  pack: Pick<ContextPack, 'id' | 'params'>,
): PackSummary {
  const params = pack.params;
  if (params && typeof params === 'object') {
    const record = params as Record<string, unknown>;
    for (const key of SUMMARY_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return { text: value.trim(), derivedFrom: 'prompt' };
      }
    }
    const recipe = record.recipe;
    if (typeof recipe === 'string' && recipe.trim()) {
      return { text: recipe.trim(), derivedFrom: 'recipe' };
    }
  }
  return { text: `Pack ${pack.id.slice(0, 8)}`, derivedFrom: 'id' };
}
