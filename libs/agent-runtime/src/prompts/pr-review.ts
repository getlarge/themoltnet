import type { PrReviewInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import {
  renderRubricCriteriaList,
  renderRubricPreambleSection,
} from './rubric-common.js';

interface Ctx {
  diaryId: string;
  taskId: string;
  workspace?: {
    mode: 'shared_mount' | 'dedicated_worktree';
    branch?: string | null;
  };
}

export function buildPrReviewUserPrompt(
  input: PrReviewInput,
  ctx: Ctx,
): string {
  const rubric = input.successCriteria.rubric!;
  const criteriaList = renderRubricCriteriaList(rubric);
  const preambleSection = renderRubricPreambleSection(rubric);
  const taskPromptSection = input.taskPrompt
    ? ['## Task-specific instructions', '', input.taskPrompt, ''].join('\n')
    : '';
  const resourceSection =
    input.subject.resourceUrls && input.subject.resourceUrls.length > 0
      ? [
          '### Resources',
          '',
          ...input.subject.resourceUrls.map((url) => `- ${url}`),
          '',
        ].join('\n')
      : '';
  const hintsSection =
    input.subject.inspectionHints && input.subject.inspectionHints.length > 0
      ? [
          '### Inspection hints',
          '',
          ...input.subject.inspectionHints.map((hint) => `- ${hint}`),
          '',
        ].join('\n')
      : '';
  const workspaceSection =
    ctx.workspace?.mode === 'dedicated_worktree'
      ? [
          '### Workspace',
          '',
          'This review attempt is running inside a dedicated disposable git',
          'worktree. Inspect and reason inside this workspace only.',
          ctx.workspace.branch
            ? `The current review branch is \`${ctx.workspace.branch}\`.`
            : 'The current checkout is disposable and will be cleaned up when the task ends.',
          '',
        ].join('\n')
      : '';

  const lines = [
    '# Review Agent',
    '',
    'You are an independent judge. You did NOT produce the subject under review.',
    'Assess it strictly against the rubric below and emit a structured judgment.',
    'You may inspect the local workspace and the referenced resources, but do NOT modify anything.',
    '',
    `Your diary ID is: ${ctx.diaryId}`,
    `This task's id is: ${ctx.taskId}`,
    '',
    '## Subject',
    '',
    `**Title:** ${input.subject.title}`,
    '',
    input.subject.summary,
    '',
    resourceSection,
    hintsSection,
    workspaceSection,
    '### Execution contract',
    '',
    'Treat the provided subject, resources, inspection hints, and any',
    'task-specific instructions as the full',
    'review contract for this task.',
    '',
    'If the task-specific instructions or inspection hints require an outward action tied to the review',
    '(for example publishing the judgment somewhere), perform that action as',
    'part of the task before reporting structured output.',
    '',
    '## Review workflow',
    '',
    '1. Read the subject summary, resources, inspection hints, and any',
    '   task-specific instructions before scoring.',
    '2. Inspect the target artefact directly using the tools and resources the',
    '   task makes available.',
    '3. If you are in a dedicated disposable worktree and need the review target',
    '   checked out locally, do that work inside this disposable workspace only.',
    '4. Apply the rubric strictly. This task is about complexity and',
    '   reviewability, not correctness or feature desirability.',
    '5. Perform any required outward action before emitting the final',
    '   structured output.',
    '',
    taskPromptSection,
    preambleSection,
    '## Criteria',
    '',
    criteriaList,
    '',
    '### Scoring rules',
    '',
    '- Every criterion uses binary scoring only.',
    '- Score `1` when the subject clearly clears the criterion.',
    '- Score `0` when it does not, or when the evidence is ambiguous.',
    '- `rationale` is REQUIRED for every score. Keep it concrete and audit-friendly.',
    '- Compute `composite = Σ(weight_i × score_i)` exactly; the runtime rejects mismatches.',
    '',
    'Write a signed diary entry (tags: `judgment`, `pr_review`) capturing the rationale before reporting structured output.',
    '',
    buildFinalOutputBlock({
      taskType: 'pr_review',
      outputSchemaName: 'PrReviewOutput',
      shapeSketch: [
        '{',
        '  "scores": [',
        '    { "criterionId": "...", "score": 0, "rationale": "..." }',
        '  ],',
        '  "composite": <sum-of-weighted-binary-scores>,',
        '  "verdict": "<1-3 sentence overall>"',
        '}',
      ].join('\n'),
      extraNotes: [
        '`scores` MUST stay in the same order as the rubric criteria.',
        '`score` MUST be exactly `0` or `1` for every criterion.',
      ],
    }),
  ];

  return lines.filter(Boolean).join('\n');
}
