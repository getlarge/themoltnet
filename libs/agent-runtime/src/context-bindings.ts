import type { ContextRef } from '@moltnet/tasks';

const PROMPT_SEPARATOR = '\n\n---\n\n';
const MAX_MERGED_RUNTIME_CONTEXT_ENTRIES = 10;

export interface ContextDeliverer {
  /**
   * Persist skill bytes at the runtime's skill-discovery path. The daemon
   * decides where (e.g. /home/agent/.pi/skills/<slug>/SKILL.md) and
   * whether to write to a local FS, a sandbox VM, or somewhere else.
   */
  skill: (args: { slug: string; content: string }) => Promise<void>;
  /**
   * Persist raw context bytes at the runtime's task-context path. Used by
   * `context_inline` so both the producer and downstream judge can inspect
   * exactly what context was supplied without mutating the workspace.
   */
  contextFile: (args: {
    slug: string;
    content: string;
    suggestedFileName: string;
  }) => Promise<void>;
}

export interface ResolveContextArgs {
  context: readonly ContextRef[];
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
 * Merge runtime-profile context defaults with task-scoped context. Profile
 * entries are defaults; task entries with the same slug override them.
 */
export function mergeRuntimeProfileContext(
  profileContext: readonly ContextRef[],
  taskContext: readonly ContextRef[],
): ContextRef[] {
  const taskSlugs = new Set(taskContext.map((ref) => ref.slug));
  const merged = [
    ...profileContext.filter((ref) => !taskSlugs.has(ref.slug)),
    ...taskContext,
  ];
  if (merged.length > MAX_MERGED_RUNTIME_CONTEXT_ENTRIES) {
    throw new Error(
      `merged runtime context has ${merged.length} entries; maximum is ${MAX_MERGED_RUNTIME_CONTEXT_ENTRIES}`,
    );
  }
  return merged;
}

/**
 * Resolve runtime context entries into delivered side-effects (skills
 * persisted via `deliver.skill`) and prompt fragments
 * (`systemPromptPrefix`, `userInlineSuffix`) the caller weaves into the
 * built prompt.
 *
 * Per-binding semantics (V1):
 *   - `skill`         → `deliver.skill({ slug, content })` once per ref.
 *                       Slug collisions on distinct contents are
 *                       refused loudly.
 *   - `context_inline`→ persist raw bytes via `deliver.contextFile(...)`
 *                       and inject them into the prompt in an explicit,
 *                       named block. Intended for eval/context experiments
 *                       where the content must be in the model context
 *                       window, not merely discoverable as a skill.
 *   - `prompt_prefix` → content appended to `systemPromptPrefix` with
 *                       the canonical `\n\n---\n\n` separator (in
 *                       declared order).
 *   - `user_inline`   → content appended to `userInlineSuffix` in
 *                       declared order, same separator.
 *
 * No fetching, no hashing — bytes are inlined in `ContextRef.content`.
 * Task-scoped entries are pinned by the task's `inputCid`; profile-scoped
 * entries are pinned by the runtime profile revision/source the daemon
 * resolved. The resolver just dispatches already-selected bytes.
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
    } else if (ref.binding === 'context_inline') {
      await args.deliver.contextFile({
        slug: ref.slug,
        content: ref.content,
        suggestedFileName: `${ref.slug}.md`,
      });
      promptParts.push(formatInlineContextBlock(ref.slug, ref.content));
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

function formatInlineContextBlock(slug: string, content: string): string {
  return [
    '### Injected Task Context',
    '',
    `Context id: \`${slug}\``,
    'The following raw context was selected for this task by its task input',
    'or runtime profile. Treat it as task-relevant background that may',
    'override generic coding instincts when it contains repo- or',
    'workflow-specific constraints.',
    'The same content may also be materialized by the runtime under',
    '`/moltnet-task-context/context` for tool-based inspection. Do not',
    'create or rely on workspace mirror files for this runtime context.',
    '',
    '<context>',
    content,
    '</context>',
  ].join('\n');
}
