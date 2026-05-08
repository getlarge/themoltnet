import type { RunEvalInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  /** Task id — the agent must report it in its final structured output. */
  taskId: string;
}

/**
 * Build the system prompt for a `run_eval` task.
 *
 * Free-form: no git workflow, no commit ceremony. The executor produces
 * a textual response (and optional file artifacts) that a later
 * `judge_eval_variant` task (Slice 2) grades against the rubric.
 *
 * Context delivery is daemon-side (see
 * apps/agent-daemon/src/lib/context-bindings.ts) and lands BEFORE this
 * prompt is rendered: `prompt_prefix` items are concatenated ahead of
 * the body, `skill` items are written to disk under
 * /home/agent/.pi/skills/<slug>/SKILL.md, and `user_inline` items are
 * appended to the first user message. This builder does NOT inline
 * `input.context[]` itself.
 */
export function buildRunEvalPrompt(input: RunEvalInput, ctx: Ctx): string {
  const { scenario, variantLabel, model, successCriteria } = input;

  const inputFilesSection = scenario.inputFiles?.length
    ? [
        '### Input files',
        '',
        ...scenario.inputFiles.map((f) => `- \`${f}\``),
        '',
      ].join('\n')
    : '';

  const verificationSection = successCriteria
    ? buildSelfVerificationBlock(ctx.taskId)
    : '';

  const lines = [
    '# Run Eval Agent',
    '',
    `You are running an evaluation scenario as variant \`${variantLabel}\` against model \`${model}\`.`,
    `Task id: \`${ctx.taskId}\``,
    '',
    '### Scenario',
    '',
    scenario.prompt,
    '',
    inputFilesSection,
    verificationSection,
    buildFinalOutputBlock({
      taskType: 'run_eval',
      outputSchemaName: 'RunEvalOutput',
      shapeSketch: [
        '{',
        '  "response": "<your free-form answer>",',
        '  "artifacts": [{ "path": "...", "cid": "..." }],  // optional',
        '  "totalTokens": <int>,',
        '  "durationMs": <int>,',
        '  "traceparent": "<from claim>",',
        '  "verification": <required iff input.successCriteria; see Self-verification>',
        '}',
      ].join('\n'),
    }),
  ];

  return lines.join('\n');
}
