import type { FulfillBriefInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  /** Task id — the agent must report it in its final structured output. */
  taskId: string;
  /**
   * Optional MoltNet correlationId. When present, the prompt mandates a
   * `moltnet/<correlationId>/<slug>` branch name and a
   * `Moltnet-Correlation-Id: <id>` trailer on the first commit so external
   * resolvers (the @moltnet-* mention bot) can recover the chain id from
   * the resulting PR even if the MoltNet API is unreachable.
   */
  correlationId?: string | null;
}

/**
 * Build the first user-message prompt for a `fulfill_brief` task.
 *
 * Generalized from the original `resolve-issue` prompt. No longer
 * GitHub-specific; references live on `Task.references[]` and the agent
 * is told to inspect them itself.
 */
export function buildFulfillBriefUserPrompt(
  input: FulfillBriefInput,
  ctx: Ctx,
): string {
  const { brief, title, acceptanceCriteria, seedFiles, scopeHint } = input;

  const criteriaSection = acceptanceCriteria?.length
    ? [
        '### Acceptance criteria',
        '',
        ...acceptanceCriteria.map((c) => `- ${c}`),
        '',
      ].join('\n')
    : '';

  const seedSection = seedFiles?.length
    ? [
        '### Seed files',
        '',
        'Start by reading these files to ground yourself:',
        ...seedFiles.map((f) => `- \`${f}\``),
        '',
      ].join('\n')
    : '';

  const branchSlug = ctx.correlationId
    ? `moltnet/${ctx.correlationId}/`
    : scopeHint
      ? `feat/${scopeHint}-`
      : 'feat/';

  const correlationSection = ctx.correlationId
    ? [
        '### Correlation',
        '',
        `This task carries correlationId \`${ctx.correlationId}\`. You MUST:`,
        '',
        `1. Name your branch \`moltnet/${ctx.correlationId}/<short-slug>\` — use a`,
        '   slug derived from the brief title (lowercase-kebab, ≤60 chars).',
        `2. Include the trailer \`Moltnet-Correlation-Id: ${ctx.correlationId}\` on`,
        '   your **first** commit on that branch (subsequent commits do not need it).',
        '',
        'These are recovery anchors for the MoltNet mention-bot. Do not deviate',
        'from this branch naming scheme when correlationId is set.',
        '',
      ].join('\n')
    : '';

  const lines = [
    '# Fulfill Brief Agent',
    '',
    'You are a software engineering agent working in a sandboxed environment.',
    'Your workspace is at /workspace (mounted from the host repository).',
    'The MoltNet runtime instructor (above, in this system prompt) defines the',
    'invariants for this task: identity, gh authentication, diary discipline,',
    'and the accountable-commit shape. Follow it for every commit.',
    '',
    `## Task: ${title ?? 'Fulfill brief'}`,
    '',
    `Task id: \`${ctx.taskId}\``,
    '',
    '### Brief',
    '',
    brief,
    '',
    criteriaSection,
    seedSection,
    correlationSection,
    '### Workflow',
    '',
    `1. Create a feature branch (starting prefix suggestion: \`${branchSlug}<short-slug>\`).`,
    '2. Understand the problem — read relevant code; do not speculate.',
    '3. Implement the change. Keep commits small and coherent.',
    '4. Add tests if applicable.',
    '5. For every commit, create a signed diary entry first via',
    '   `moltnet_create_entry` and embed its id in the commit trailer',
    '   `MoltNet-Diary: <id>` (per the runtime instructor).',
    '6. Push the branch and open a PR.',
    '',
    buildSelfVerificationBlock(ctx.taskId),
    buildFinalOutputBlock({
      taskType: 'fulfill_brief',
      outputSchemaName: 'FulfillBriefOutput',
      shapeSketch: [
        '{',
        '  "branch": "<branch-name>",',
        '  "commits": [{ "sha": "...", "message": "...", "diaryEntryId": "..." }],',
        '  "pullRequestUrl": "<url-or-null>",',
        '  "diaryEntryIds": ["..."],',
        '  "summary": "<1-3 sentence recap>",',
        '  "verification": <required iff input.successCriteria; see Self-verification>',
        '}',
      ].join('\n'),
    }),
  ];

  return lines.filter(Boolean).join('\n');
}
