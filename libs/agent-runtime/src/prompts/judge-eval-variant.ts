import type { JudgeEvalVariantInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the first user-message prompt for a `judge_eval_variant` task
 * (#943 Slice 2).
 *
 * The parent agent's job is **fan-out-and-collect**: for each
 * `runTaskIds[i]`, spawn an isolated subagent via the `subagent` custom
 * tool (#1087), have it grade that variant against the shared rubric,
 * and collect each subagent's structured `judge_eval_variant_result`
 * payload. The parent does NOT grade itself; it composes the per-
 * variant results into the final `judge_eval_variant` output (results
 * array + optional deltas + verdicts).
 *
 * Isolation is the point: each variant gets a fresh subagent session
 * with no carryover context from sibling variants, so per-variant
 * grading is independent. Cost is bounded by `maxItems: 10` on
 * runTaskIds.
 */
export function buildJudgeEvalVariantUserPrompt(
  input: JudgeEvalVariantInput,
  ctx: Ctx,
): string {
  const { runTaskIds, successCriteria } = input;
  const rubric = successCriteria.rubric;
  if (!rubric) {
    // Validation should have caught this — defensive.
    throw new Error(
      'judge_eval_variant requires successCriteria.rubric — none present',
    );
  }

  // Markdown table cell escaping: backslash first, then pipe. Order
  // matters — escaping `|` first would double-escape the backslashes
  // we just emitted. Newlines collapse to a space (Markdown table
  // cells are single-line).
  const escapeCell = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const criteriaTable = rubric.criteria
    .map(
      (c) =>
        `| \`${c.id}\` | ${c.weight.toFixed(3)} | ${c.scoring} | ${escapeCell(c.description)} |`,
    )
    .join('\n');

  const targetsBlock = runTaskIds
    .map((id, i) => `${i + 1}. \`${id}\``)
    .join('\n');

  const finalOutputBlock = buildFinalOutputBlock({
    taskType: 'judge_eval_variant',
    outputSchemaName: 'JudgeEvalVariantOutput',
    shapeSketch: [
      '{',
      '  "results": [',
      '    {',
      '      "runTaskId": "<runTaskIds[i]>",',
      '      "variantLabel": "<from variant input>",',
      '      "scores": [ { "criterionId": "...", "score": 0..1, "rationale": "...", "assertions": [...]? } ],',
      '      "composite": <Σ(weight × score), 0..1>,',
      '      "verdict": "<1-3 sentences>"',
      '    },',
      '    ...one entry per runTaskIds[i], same order',
      '  ],',
      '  "deltas": { "<labelA> - <labelB>": <composite(A) - composite(B)> },  // optional',
      '  "judgeModel": "<id>",  // optional',
      '  "traceparent": "<from claim>"',
      '}',
    ].join('\n'),
  });

  return [
    '# Judge Eval Variants\n',
    `You are grading ${runTaskIds.length} variants of a single run_eval scenario`,
    'against ONE shared rubric. Your job is fan-out-and-collect — you do not',
    'grade yourself.',
    '',
    `Task id: \`${ctx.taskId}\``,
    `Diary: \`${ctx.diaryId}\``,
    '',
    '### Targets (variants to grade)',
    '',
    targetsBlock,
    '',
    'Each target is a completed `run_eval` task in the same correlation group.',
    'Read its accepted attempt via `moltnet_get_task` / `moltnet_list_task_attempts`',
    "to see the producer's output before grading.",
    '',
    '### Rubric',
    '',
    rubric.preamble ? `${rubric.preamble}\n` : '',
    '| Criterion | Weight | Scoring | Description |',
    '| --- | --- | --- | --- |',
    criteriaTable,
    '',
    '### How to grade',
    '',
    'For EACH `runTaskIds[i]`:',
    '',
    '1. Call the `subagent` custom tool with:',
    '   - `task`: a brief instructing the subagent to grade ONLY that variant',
    '     against the rubric above; include the target task id and the rubric',
    '     verbatim. The subagent has the same MoltNet tools and can fetch the',
    '     accepted attempt output independently.',
    '   - `output_schema`: `"judge_eval_variant_result"`',
    "2. Receive the subagent's structured `judge_eval_variant_result` payload.",
    '3. Append it to your `results[]` array, **in the same order as input.runTaskIds**.',
    '',
    'Do NOT score any variant in your own session. The whole point of the',
    'subagent fan-out is per-variant context isolation — grading two variants',
    'back-to-back in one session lets the second be biased by the first.',
    '',
    '### Composite arithmetic',
    '',
    'Each `composite` MUST equal `Σ(criterion.weight × score)` over the rubric',
    'criteria. Drift > 0.001 is rejected. Subagents are instructed to compute it',
    'themselves; double-check before assembling the final output.',
    '',
    '### Deltas (optional)',
    '',
    'If useful, populate `deltas` with pairwise composite differences keyed by',
    '`"<variantLabel-A> - <variantLabel-B>"` (single space-hyphen-space). Both',
    'labels must appear in `results`. Omit `deltas` entirely if not used.',
    '',
    finalOutputBlock,
  ]
    .filter((s) => s !== '')
    .join('\n');
}
