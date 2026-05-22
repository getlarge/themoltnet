/**
 * Shared prompt assembler for every task-type user-prompt builder
 * (issue #1175, area 5).
 *
 * One single standard across all eight builders:
 * - A builder declares its prompt as an ordered `PromptSection[]`.
 * - Each section has `id`, `source`, optional `header`, and `body`.
 * - The assembler renders `header` as `## ${header}` above `body`
 *   (level-2 heading — top-of-prompt role framing uses level-1 inside
 *   `body` directly).
 * - Sections are joined with `\n\n`. The assembler is responsible for
 *   the inter-section gap; section bodies must not start or end with a
 *   blank line. Builders just produce content.
 * - Empty bodies are dropped from rendered text but kept in the trace
 *   with `char_count: 0`, so consumers can see "section X was absent".
 *
 * The structured trace is forwarded to the `prompt_assembled` attempt
 * event so "what did the model actually see?" becomes queryable from
 * the event stream.
 */

export type PromptSectionSource =
  /** Top role-framing heading (e.g. `# Fulfill Brief Agent`). */
  | 'header'
  /** Hardcoded copy that doesn't vary with task input. */
  | 'static'
  /** Pulled from `task.input` (brief text, scenario prompt, etc.). */
  | 'task_input'
  /** Resolved `context_inline` / `prompt_prefix` / `user_inline` body. */
  | 'context_binding'
  /** Injected-context discipline guidance. */
  | 'discipline'
  /** Self-verification block. */
  | 'verification'
  /** Submit-tool closing block. */
  | 'final_output'
  /** Workspace shape / attachment hints. */
  | 'workspace'
  /** Judge-only rubric. Forbidden in producer prompts. */
  | 'rubric_judge'
  /** Judge evidence-gathering block. */
  | 'evidence';

export interface PromptSection {
  /**
   * Stable, task-type-namespaced identifier, e.g. `run_eval.scenario`
   * or `judge_pack.rubric`. Used by replay tooling to query "what did
   * the model see in section X" across runs.
   */
  id: string;
  source: PromptSectionSource;
  /**
   * Optional level-2 heading the assembler renders as `## ${header}`
   * directly above `body`. Builders should NOT duplicate the heading
   * inside `body`.
   */
  header?: string;
  /**
   * Section content. Should not start or end with blank lines — the
   * assembler controls inter-section spacing. Empty string signals
   * "this section was conditionally absent for this input".
   */
  body: string;
}

export interface PromptSectionTrace {
  id: string;
  source: PromptSectionSource;
  header?: string;
  /** Length of `body` in characters. 0 when the section was absent. */
  char_count: number;
}

export interface AssembledPrompt {
  /** Rendered user-prompt string passed to pi's `session.prompt`. */
  text: string;
  /** Per-section trace forwarded to the `prompt_assembled` event. */
  trace: PromptSectionTrace[];
  /** Task type slug, e.g. `run_eval`. Mirrored from the call. */
  taskType: string;
}

/**
 * Render a `PromptSection[]` into final text + structured trace.
 * Single source of truth for inter-section spacing and header
 * rendering across all task types.
 */
export function assembleTaskPrompt(
  taskType: string,
  sections: PromptSection[],
): AssembledPrompt {
  const trace: PromptSectionTrace[] = [];
  const rendered: string[] = [];

  for (const section of sections) {
    trace.push({
      id: section.id,
      source: section.source,
      header: section.header,
      char_count: section.body.length,
    });
    if (section.body === '') continue;
    rendered.push(
      section.header ? `## ${section.header}\n\n${section.body}` : section.body,
    );
  }

  return {
    text: rendered.join('\n\n'),
    trace,
    taskType,
  };
}
