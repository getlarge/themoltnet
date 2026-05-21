import type { JudgeEvalAttemptInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';

interface Ctx {
  diaryId: string;
  taskId: string;
  workspace?: {
    mode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
    branch?: string | null;
    attached?: boolean;
  };
}

export function buildJudgeEvalAttemptUserPrompt(
  input: JudgeEvalAttemptInput,
  ctx: Ctx,
): string {
  const rubric = input.successCriteria.rubric;
  if (!rubric) {
    throw new Error(
      'judge_eval_attempt requires successCriteria.rubric — none present',
    );
  }

  const escapeCell = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const criteriaTable = rubric.criteria
    .map(
      (c) =>
        `| \`${c.id}\` | ${c.weight.toFixed(3)} | ${c.scoring} | ${escapeCell(c.description)} |`,
    )
    .join('\n');

  const finalOutputBlock = buildFinalOutputBlock({
    taskType: 'judge_eval_attempt',
    outputSchemaName: 'JudgeEvalAttemptOutput',
    shapeSketch: [
      '{',
      `  "targetTaskId": "${input.targetTaskId}",`,
      `  "targetAttemptN": ${input.targetAttemptN},`,
      '  "variantLabel": "<from producer input>",',
      '  "scores": [ { "criterionId": "...", "score": 0..1, "rationale": "...", "assertions": [...]? } ],',
      '  "composite": <Σ(weight × score), 0..1>,',
      '  "verdict": "<1-3 sentences>",',
      '  "judgeModel": "<id>",  // optional',
      '  "traceparent": "<from claim>"',
      '}',
    ].join('\n'),
  });

  const workspaceSection =
    ctx.workspace?.attached === true
      ? [
          '### Workspace',
          '',
          'Your current workspace is already attached to the producer attempt',
          'you are judging. Inspect files directly from the current workspace',
          'root instead of inventing synthetic `artifact_<taskId>` paths.',
          'If the accepted attempt output lists `artifacts[].path`, treat those',
          'paths as relative to the current workspace root unless the output',
          'explicitly says otherwise.',
          ctx.workspace.mode === 'dedicated_worktree'
            ? `This attachment is a dedicated producer worktree${ctx.workspace.branch ? ` on branch \`${ctx.workspace.branch}\`` : ''}.`
            : ctx.workspace.mode === 'scratch_mount'
              ? 'This workspace is a fresh judge-owned scratch copy of the producer workspace.'
              : 'This attachment is the producer shared workspace mounted with shadow writes for safe inspection.',
          '',
        ].join('\n')
      : '';

  return [
    '# Judge Eval Attempt\n',
    'You are grading one accepted `run_eval` producer attempt against a hidden',
    'judge rubric. Do not delegate to subagents. Grade in this session only.',
    '',
    `Task id: \`${ctx.taskId}\``,
    `Diary: \`${ctx.diaryId}\``,
    `Producer task: \`${input.targetTaskId}\``,
    `Producer attempt: \`${input.targetAttemptN}\``,
    '',
    '### Evidence gathering',
    '',
    `1. Call \`moltnet_get_task\` with taskId=\`${input.targetTaskId}\`.`,
    `2. Call \`moltnet_list_task_attempts\` with taskId=\`${input.targetTaskId}\` and inspect the accepted attempt matching \`${input.targetAttemptN}\`.`,
    `3. Call \`moltnet_list_task_messages\` with taskId=\`${input.targetTaskId}\`, attemptN=\`${input.targetAttemptN}\` to inspect the producer's turn-by-turn behavior.`,
    '4. Use the accepted attempt output, attempt messages, and any accessible',
    '   artifacts or workspace evidence available in your environment.',
    '   Read artifact files from the mounted producer workspace when present;',
    '   do not assume detached `artifact_<taskId>` directories exist.',
    '5. Score strictly against the rubric below.',
    '',
    workspaceSection,
    '### Rubric',
    '',
    rubric.preamble ? `${rubric.preamble}\n` : '',
    '| Criterion | Weight | Scoring | Description |',
    '| --- | --- | --- | --- |',
    criteriaTable,
    '',
    '### Composite arithmetic',
    '',
    'Your `composite` MUST equal `Σ(criterion.weight × score)` over the rubric',
    'criteria. Drift > 0.001 is rejected.',
    '',
    finalOutputBlock,
  ]
    .filter((s) => s !== '')
    .join('\n');
}
