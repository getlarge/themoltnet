import type { ContextRef, RunEvalInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';

interface Ctx {
  diaryId: string;
  /** Task id — the agent must report it in its final structured output. */
  taskId: string;
  /**
   * MoltNet correlationId. Recorded on the task object so attempt events
   * can group sibling variants of an eval scenario; intentionally NOT
   * surfaced in the user prompt — the producer never acts on it.
   */
  correlationId?: string | null;
  effectiveRuntimeContext?: readonly ContextRef[];
}

/**
 * Build the first user-message prompt for a `run_eval` task.
 *
 * Free-form: no git workflow, no commit ceremony. The executor produces
 * a textual response (and optional file artifacts) that later
 * `judge_eval_attempt` task(s) grade against their own hidden rubric.
 *
 * Context delivery is handled by `resolveTaskContext` (see
 * libs/agent-runtime/src/context-bindings.ts) and is selected BEFORE this
 * prompt is rendered. Task-scoped context lives in `input.context`; runtime
 * profile defaults arrive as `ctx.effectiveRuntimeContext` after the runtime
 * merges them with task context. This builder only renders context
 * discipline; it does NOT inline context bytes itself.
 *
 * Prompt-shape notes (issue #1175, area 1):
 * - No `Correlation` section: the agent never acts on it. The id is
 *   still carried on attempt event metadata for cross-variant queries.
 * - No `Execution mode` section: the workspace already reflects the
 *   chosen mode by its shape (scratch/shared mount/dedicated worktree).
 *   Restating it as text adds noise without changing model behavior.
 * - The "Injected Task Context" phrase is used identically in this
 *   prompt's discipline section and in the materialized context block
 *   header (see context-bindings.ts) so weaker models see one repeated
 *   anchor.
 * - The discipline copy demands the model encode injected constraints
 *   into the code path itself, not into comments or the verification
 *   field. Quoting the constraint back is not following the task.
 */
export function buildRunEvalUserPrompt(
  input: RunEvalInput,
  ctx: Ctx,
): AssembledPrompt {
  const { scenario, variantLabel } = input;
  const effectiveRuntimeContext = ctx.effectiveRuntimeContext ?? input.context;
  const hasContext = effectiveRuntimeContext.length > 0;
  const hasInlineContext = effectiveRuntimeContext.some(
    (entry) => entry.binding === 'context_inline',
  );

  const header =
    `# Run Eval Agent\n\n` +
    `You are running an evaluation scenario as variant \`${variantLabel}\`.\n` +
    `Task id: \`${ctx.taskId}\``;

  const contextDiscipline = hasContext
    ? [
        'This task includes Injected Task Context supplied by the task',
        'input or runtime profile. You MUST inspect it BEFORE you write solution files or',
        'draft your final answer — not after.',
        '',
        'Reconcile every constraint from that context **into the code path',
        'itself**: function bodies, control flow, transaction boundaries,',
        'guard clauses. Quoting a constraint back in a comment, a',
        '`// note:` line, the task summary, or the `verification` field is',
        'NOT following the task. If the constraint affects behavior, it',
        'must affect behavior.',
        hasInlineContext
          ? 'For `context_inline`, your FIRST content-inspection step is to read the injected context block in this prompt or, when available, the matching file under `/moltnet-task-context/context` before your first `write` call. Do not create or rely on workspace mirror files for injected context.'
          : 'When the context is delivered as a skill, inspect it before solving.',
        'If the Injected Task Context contains repo- or workflow-specific',
        'rules, those rules override your generic instincts.',
      ].join('\n')
    : '';

  const inputFiles = scenario.inputFiles?.length
    ? scenario.inputFiles.map((f) => `- \`${f}\``).join('\n')
    : '';

  const sections: PromptSection[] = [
    { id: 'run_eval.header', source: 'header', body: header },
    {
      id: 'run_eval.context_discipline',
      source: 'discipline',
      header: 'Injected Task Context',
      body: contextDiscipline,
    },
    {
      id: 'run_eval.scenario',
      source: 'task_input',
      header: 'Scenario',
      body: scenario.prompt,
    },
    {
      id: 'run_eval.input_files',
      source: 'task_input',
      header: 'Input files',
      body: inputFiles,
    },
  ];

  return assembleTaskPrompt('run_eval', sections);
}
