import type { AssessBriefInput } from '@moltnet/tasks';

interface Ctx {
  diaryId: string;
  taskId: string;
  /**
   * The `fulfill_brief` task being judged. Resolved by the runtime at
   * prompt-build time so the judge can work without an extra fetch.
   */
  target: {
    taskId: string;
    branch: string | null;
    pullRequestUrl: string | null;
    summary: string | null;
    commitShas: string[];
    diaryEntryIds: string[];
  };
}

export function buildAssessBriefPrompt(
  input: AssessBriefInput,
  ctx: Ctx,
): string {
  const criteriaList = input.criteria
    .map(
      (c, i) =>
        `${i + 1}. **${c.id}** (weight ${c.weight}, scoring: \`${c.scoring}\`) — ${c.description}`,
    )
    .join('\n');

  const commitSection = ctx.target.commitShas.length
    ? [
        '### Commits',
        '',
        ...ctx.target.commitShas.map((s) => `- ${s}`),
        '',
      ].join('\n')
    : '';

  const diarySection = ctx.target.diaryEntryIds.length
    ? [
        '### Diary entries produced during fulfillment',
        '',
        ...ctx.target.diaryEntryIds.map((id) => `- ${id}`),
        '',
      ].join('\n')
    : '';

  const preambleSection = input.rubricPreamble
    ? ['### Rubric preamble', '', input.rubricPreamble, ''].join('\n')
    : '';

  const lines = [
    '# Assess Brief Judge',
    '',
    'You are an independent judge. You did NOT produce the work under review.',
    'Score each criterion as specified below and emit a structured judgment.',
    'You may read code, commits, and diary entries — but do NOT modify anything.',
    '',
    `Your diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Target of assessment',
    '',
    `**fulfill_brief task id:** ${ctx.target.taskId}`,
    ctx.target.branch ? `**Branch:** \`${ctx.target.branch}\`` : '',
    ctx.target.pullRequestUrl ? `**PR:** ${ctx.target.pullRequestUrl}` : '',
    ctx.target.summary ? `**Producer summary:** ${ctx.target.summary}` : '',
    '',
    commitSection,
    diarySection,
    preambleSection,
    '## Criteria',
    '',
    criteriaList,
    '',
    '### Scoring rules',
    '',
    '- `llm_judged`: score 0..1 continuous. `rationale` REQUIRED (2–4 sentences).',
    '- `boolean`: score exactly 0 or 1. `rationale` optional.',
    '- `deterministic_signature_check`: run `moltnet entry verify` on every diary entry listed above AND `git verify-commit` on every commit. Score 1 iff ALL signatures are valid; otherwise 0. Populate `evidence.commitsVerified`, `evidence.commitsTotal`, `evidence.signatureFailures`.',
    '',
    '### Final output',
    '',
    'Emit a JSON object matching `AssessBriefOutput`:',
    '  { "scores": [{criterionId, score, rationale?, evidence?}], "composite", "verdict", "judgeModel"? }',
    '`composite` = Σ(weight_i × score_i) recomputed. The runtime will reject a mismatch.',
    'Write a signed diary entry (tags: "judgment", "assess_brief") capturing the rationale before emitting the JSON.',
  ];

  return lines.filter(Boolean).join('\n');
}
