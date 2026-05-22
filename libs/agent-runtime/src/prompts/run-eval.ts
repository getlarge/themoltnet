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
   * MoltNet correlationId. For eval scenarios this groups the N variant
   * `run_eval` tasks plus any eventual `judge_eval_attempt` tasks under a
   * single id. May be null for ad-hoc single-variant runs.
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
 */
export function buildRunEvalUserPrompt(
  input: RunEvalInput,
  ctx: Ctx,
): AssembledPrompt {
  const { scenario, variantLabel, execution, successCriteria } = input;
  const hasContext = input.context.length > 0;
  const hasInlineContext = input.context.some(
    (entry) => entry.binding === 'context_inline',
  );

  const header =
    `# Run Eval Agent\n\n` +
    `You are running an evaluation scenario as variant \`${variantLabel}\`.\n` +
    `Task id: \`${ctx.taskId}\``;

  const correlation = ctx.correlationId
    ? [
        `This task carries correlationId \`${ctx.correlationId}\`. It joins`,
        'this variant to its sibling `run_eval` tasks (other variants of the',
        'same scenario and to any later `judge_eval_attempt` tasks created',
        'against those variants. You do not need to act on it directly — it',
        'is recorded for cross-variant aggregation at query time.',
      ].join('\n')
    : '';

  const executionMode = [
    `Mode: \`${execution.mode}\``,
    `Workspace: \`${execution.workspace}\``,
    execution.workspace === 'none'
      ? 'You are running in a scratch workspace with no repository checkout mounted. Do not assume git history or repo files are present unless the scenario provided them explicitly.'
      : execution.workspace === 'shared_mount'
        ? 'You are running against the daemon shared mount. Treat any repository mutations as affecting the mounted checkout directly.'
        : 'You are running in a dedicated disposable git worktree isolated from the daemon shared checkout.',
  ].join('\n');

  const contextDiscipline = hasContext
    ? [
        'This task includes extra injected context from the task creator.',
        'You MUST inspect and use that context BEFORE you write solution',
        'files or draft your final answer.',
        'Do not solve first and only review the context afterward.',
        hasInlineContext
          ? 'For `context_inline`, your FIRST content-inspection step should be a `read` of `/workspace/context-pack.md` before your first `write` call. The same content is also mirrored in `/workspace/AGENTS.md` and may be referenced from `/workspace/.claude/CLAUDE.md`.'
          : 'If injected context was provided as a skill, inspect that task-injected context before solving.',
        hasInlineContext
          ? 'If `/workspace/context-pack.md` exists and you skip reading it before writing solution files, you are not following the task instructions.'
          : 'Do not rely on memory alone when task-injected context is available; inspect it first.',
        'If the injected context contains repo- or workflow-specific rules,',
        'those rules override your generic instincts.',
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
      id: 'run_eval.correlation',
      source: 'task_input',
      header: 'Correlation',
      body: correlation,
    },
    {
      id: 'run_eval.execution_mode',
      source: 'task_input',
      header: 'Execution mode',
      body: executionMode,
    },
    {
      id: 'run_eval.context_discipline',
      source: 'discipline',
      header: 'Injected context discipline',
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
