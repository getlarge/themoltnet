import type { RunEvalInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  /** Task id — the agent must report it in its final structured output. */
  taskId: string;
  /**
   * MoltNet correlationId. For eval scenarios this groups the N variant
   * `run_eval` tasks plus the eventual `judge_eval_variant` task under a
   * single id. May be null for ad-hoc single-variant runs.
   */
  correlationId?: string | null;
}

/**
 * Build the system prompt for a `run_eval` task.
 *
 * Free-form: no git workflow, no commit ceremony. The executor produces
 * a textual response (and optional file artifacts) that a later
 * `judge_eval_variant` task (Slice 2) grades against the rubric.
 *
 * Context delivery is handled by `resolveTaskContext` (see
 * libs/agent-runtime/src/context-bindings.ts) and runs BEFORE this
 * prompt is rendered: `prompt_prefix` items are concatenated ahead of
 * the body, `skill` items are persisted at the runtime's skill path,
 * and `user_inline` items are appended to the first user message. This
 * builder does NOT inline `input.context[]` itself.
 */
export function buildRunEvalPrompt(input: RunEvalInput, ctx: Ctx): string {
  const { scenario, variantLabel, successCriteria } = input;

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

  const correlationSection = ctx.correlationId
    ? [
        '### Correlation',
        '',
        `This task carries correlationId \`${ctx.correlationId}\`. It joins`,
        'this variant to its sibling `run_eval` tasks (other variants of the',
        'same scenario) and to the eventual `judge_eval_variant` task that',
        'will grade them together. You do not need to act on it directly —',
        'it is recorded for cross-variant aggregation at query time.',
        '',
      ].join('\n')
    : '';

  const finalOutputBlock = buildFinalOutputBlock({
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
  });

  // Each section already carries its own internal blank lines. Drop
  // sections that are absent so we never emit consecutive blanks.
  const sections = [
    '# Run Eval Agent\n',
    `You are running an evaluation scenario as variant \`${variantLabel}\`.\nTask id: \`${ctx.taskId}\`\n`,
    correlationSection,
    `### Scenario\n\n${scenario.prompt}\n`,
    inputFilesSection,
    verificationSection,
    finalOutputBlock,
  ].filter((s) => s !== '');

  return sections.join('\n');
}
