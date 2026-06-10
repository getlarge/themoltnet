import type { RunEvalInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';
import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

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
}

/**
 * Build the first user-message prompt for a `run_eval` task.
 *
 * Free-form: no git workflow, no commit ceremony. The executor produces
 * a textual response (and optional file artifacts) that later
 * `judge_eval_attempt` task(s) grade against their own hidden rubric.
 *
 * Context delivery is handled by `resolveTaskContext` (see
 * libs/agent-runtime/src/context-bindings.ts) and runs BEFORE this
 * prompt is rendered: `prompt_prefix` items are concatenated ahead of
 * the body, `skill` items are persisted at the runtime's skill path,
 * and `user_inline` items are appended to the first user message. This
 * builder does NOT inline `input.context[]` itself.
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
  const { scenario, variantLabel, successCriteria } = input;
  const hasContext = input.context.length > 0;
  const hasInlineContext = input.context.some(
    (entry) => entry.binding === 'context_inline',
  );

  const header =
    `# Run Eval Agent\n\n` +
    `You are running an evaluation scenario as variant \`${variantLabel}\`.\n` +
    `Task id: \`${ctx.taskId}\``;

  const contextDiscipline = hasContext
    ? [
        'This task includes Injected Task Context supplied by the task',
        'creator. You MUST inspect it BEFORE you write solution files or',
        'draft your final answer — not after.',
        '',
        'Reconcile every constraint from that context **into the code path',
        'itself**: function bodies, control flow, transaction boundaries,',
        'guard clauses. Quoting a constraint back in a comment, a',
        '`// note:` line, the task summary, or the `verification` field is',
        'NOT following the task. If the constraint affects behavior, it',
        'must affect behavior.',
        hasInlineContext
          ? 'For `context_inline`, your FIRST content-inspection step is a `read` of `context-pack.md` in the workspace root before your first `write` call. The same content is also mirrored in `AGENTS.md` and may be referenced from `.claude/CLAUDE.md`.'
          : 'When the context is delivered as a skill, inspect it before solving.',
        'If the Injected Task Context contains repo- or workflow-specific',
        'rules, those rules override your generic instincts.',
      ].join('\n')
    : '';

  const inputFiles = scenario.inputFiles?.length
    ? scenario.inputFiles.map((f) => `- \`${f}\``).join('\n')
    : '';

  const verification = successCriteria
    ? buildSelfVerificationBlock(ctx.taskId)
    : '';

  const finalOutput = buildFinalOutputBlock({
    taskType: 'run_eval',
    outputSchemaName: 'RunEvalOutput',
    shapeSketch: [
      '{',
      '  "response": "<your free-form answer>",',
      '  "artifacts": [{ "path": "...", "cid": "..." }],  // optional',
      '  "totalTokens": <int>,',
      '  "durationMs": <int>,',
      '  "traceparent": "<from claim>",',
      '  "verification": {',
      '    "inputCid": "<task inputCid>",',
      '    "results": [',
      '      { "id": "<criterion id>", "kind": "rubric", "status": "pass|fail|skip", "detail": "<optional one-liner>" }',
      '    ],',
      '    "passed": <boolean>',
      '  } // required iff input.successCriteria; must be an object, never a string',
      '}',
    ].join('\n'),
  });

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
    {
      id: 'run_eval.verification',
      source: 'verification',
      body: verification,
    },
    {
      id: 'run_eval.final_output',
      source: 'final_output',
      body: finalOutput,
    },
  ];

  return assembleTaskPrompt('run_eval', sections);
}
