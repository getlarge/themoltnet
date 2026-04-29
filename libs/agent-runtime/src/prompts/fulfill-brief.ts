import type { FulfillBriefInput } from '@moltnet/tasks';

interface Ctx {
  diaryId: string;
  /** Task id — the agent must report it in its final structured output. */
  taskId: string;
}

/**
 * Build the system prompt for a `fulfill_brief` task.
 *
 * Generalized from the original `resolve-issue` prompt. No longer
 * GitHub-specific; references live on `Task.references[]` and the agent
 * is told to inspect them itself.
 */
export function buildFulfillBriefPrompt(
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

  const branchSlug = scopeHint ? `feat/${scopeHint}-` : 'feat/';

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
    '### Final output',
    '',
    'When done, write to stdout a JSON object with shape matching `FulfillBriefOutput`:',
    '  { "branch", "commits": [{sha, message, diaryEntryId}], "pullRequestUrl", "diaryEntryIds", "summary" }',
    'The runtime parses this as the structured task output. Failing to emit it is a failure.',
  ];

  return lines.filter(Boolean).join('\n');
}
