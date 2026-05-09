import type { ContextRef, TaskContext } from '@moltnet/tasks';

const PROMPT_SEPARATOR = '\n\n---\n\n';

export interface ContextDeliverer {
  /**
   * Persist skill bytes at the runtime's skill-discovery path. The daemon
   * decides where (e.g. /home/agent/.pi/skills/<slug>/SKILL.md) and
   * whether to write to a local FS, a sandbox VM, or somewhere else.
   */
  skill: (args: { slug: string; content: string }) => Promise<void>;
}

export interface ResolveContextArgs {
  context: TaskContext;
  deliver: ContextDeliverer;
}

export interface ResolvedContext {
  /** What was injected, in declared order. Audit log row per entry. */
  injected: ContextRef[];
  /** Prepended to the system prompt by the prompt assembler. */
  systemPromptPrefix: string;
  /** Appended to the first user message by the prompt assembler. */
  userInlineSuffix: string;
}

/**
 * Resolve `task.input.context[]` into delivered side-effects (skills
 * persisted via `deliver.skill`) and prompt fragments
 * (`systemPromptPrefix`, `userInlineSuffix`) the caller weaves into the
 * built prompt.
 *
 * Per-binding semantics (V1):
 *   - `skill`         → `deliver.skill({ slug, content })` once per ref.
 *                       Slug collisions on distinct contents are
 *                       refused loudly.
 *   - `prompt_prefix` → content appended to `systemPromptPrefix` with
 *                       the canonical `\n\n---\n\n` separator (in
 *                       declared order).
 *   - `user_inline`   → content appended to `userInlineSuffix` in
 *                       declared order, same separator.
 *
 * No fetching, no hashing — bytes are inlined in `ContextRef.content`,
 * and the task's `inputCid` already pins the entire input. The imposer
 * chose these bytes; the resolver just dispatches them.
 *
 * The function is pure with respect to its arguments: file writes are
 * confined to the injected `deliver` callback, which makes the
 * resolver trivial to test.
 */
export async function resolveTaskContext(
  args: ResolveContextArgs,
): Promise<ResolvedContext> {
  const promptParts: string[] = [];
  const userParts: string[] = [];
  const injected: ContextRef[] = [];
  const usedSlugs = new Map<string, string>();

  for (const ref of args.context) {
    if (ref.binding === 'skill') {
      const prior = usedSlugs.get(ref.slug);
      if (prior !== undefined) {
        if (prior !== ref.content) {
          throw new Error(
            `slug collision on '${ref.slug}': two skill entries share the same slug ` +
              `but have different content`,
          );
        }
        // Idempotent re-declaration of the same (slug, content) pair —
        // record it as injected for the audit log but skip re-delivery
        // so non-idempotent deliverers (e.g. ones that append rather
        // than overwrite) cannot double-write the same bytes.
        injected.push(ref);
        continue;
      }
      usedSlugs.set(ref.slug, ref.content);
      await args.deliver.skill({ slug: ref.slug, content: ref.content });
    } else if (ref.binding === 'prompt_prefix') {
      promptParts.push(ref.content);
    } else {
      userParts.push(ref.content);
    }
    injected.push(ref);
  }

  return {
    injected,
    systemPromptPrefix: promptParts.join(PROMPT_SEPARATOR),
    userInlineSuffix: userParts.join(PROMPT_SEPARATOR),
  };
}
