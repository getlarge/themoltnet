import type { FulfillBriefInput } from '@moltnet/tasks';

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
   * Optional MoltNet correlationId. When present, the prompt mandates a
   * `moltnet/<correlationId>/<slug>` branch name and a
   * `Moltnet-Correlation-Id: <id>` trailer on the first commit so external
   * resolvers (the @moltnet-* mention bot) can recover the chain id from
   * the resulting PR even if the MoltNet API is unreachable.
   */
  correlationId?: string | null;
  workspace?: {
    mode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
    branch?: string | null;
    attached?: boolean;
  };
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
): AssembledPrompt {
  const { brief, seedFiles, scopeHint } = input;

  const header = [
    '# Fulfill Brief Agent',
    '',
    'You are a software engineering agent working in a sandboxed environment.',
    'Your workspace is at /workspace (mounted from the host repository).',
    'The MoltNet runtime instructor (above, in this system prompt) defines the',
    'invariants for this task: identity, gh authentication, diary discipline,',
    'and the accountable-commit shape. Follow it for every commit.',
    '',
    '## Task: Fulfill brief',
    '',
    `Task id: \`${ctx.taskId}\``,
  ].join('\n');

  const seedFilesBody = seedFiles?.length
    ? [
        'Start by reading these files to ground yourself:',
        ...seedFiles.map((f) => `- \`${f}\``),
      ].join('\n')
    : '';

  const branchSlug = ctx.correlationId
    ? `moltnet/${ctx.correlationId}/`
    : scopeHint
      ? `feat/${scopeHint}-`
      : 'feat/';

  const correlation = ctx.correlationId
    ? [
        `This task carries correlationId \`${ctx.correlationId}\`. You MUST:`,
        '',
        `1. Name your branch \`moltnet/${ctx.correlationId}/<short-slug>\` — use a`,
        '   slug derived from the brief title (lowercase-kebab, ≤60 chars).',
        `2. Include the trailer \`Moltnet-Correlation-Id: ${ctx.correlationId}\` on`,
        '   your **first** commit on that branch (subsequent commits do not need it).',
        '',
        'These are recovery anchors for the MoltNet mention-bot. Do not deviate',
        'from this branch naming scheme when correlationId is set.',
      ].join('\n')
    : '';

  const workspace =
    ctx.workspace?.mode === 'dedicated_worktree'
      ? [
          'This attempt is running inside a dedicated git worktree created',
          'for this task. Do not repurpose or switch the primary checkout.',
          ctx.workspace.branch
            ? `The current branch is \`${ctx.workspace.branch}\`. Stay on this branch unless the runtime instructor explicitly tells you otherwise.`
            : 'Stay on the branch that was pre-provisioned for this task.',
        ].join('\n')
      : '';

  const workflow = [
    ctx.workspace?.mode === 'dedicated_worktree'
      ? `1. Use the already-provisioned dedicated worktree branch${ctx.workspace.branch ? ` (\`${ctx.workspace.branch}\`)` : ''}; do not create or switch the primary checkout.`
      : `1. Create a feature branch (starting prefix suggestion: \`${branchSlug}<short-slug>\`).`,
    '2. Understand the problem — read relevant code; do not speculate.',
    '3. Implement the change. Keep commits small and coherent.',
    '4. Add tests if applicable.',
    '5. For every commit, create a signed diary entry first via',
    '   `moltnet_create_entry` and embed its id in the commit trailer',
    '   `MoltNet-Diary: <id>` (per the runtime instructor).',
    '6. Push the branch and open a PR — run `git push` and `gh pr create`',
    '   IN the VM with your normal `bash` tool (use the',
    '   `GH_TOKEN=$(moltnet github token …) gh …` form from the runtime',
    '   instructor). Do NOT use `moltnet_host_exec` for this; it needs human',
    '   approval that is unavailable in a headless run.',
  ].join('\n');

  const sections: PromptSection[] = [
    { id: 'fulfill_brief.header', source: 'header', body: header },
    {
      id: 'fulfill_brief.brief',
      source: 'task_input',
      header: 'Brief',
      body: brief,
    },
    {
      id: 'fulfill_brief.seed_files',
      source: 'task_input',
      header: 'Seed files',
      body: seedFilesBody,
    },
    {
      id: 'fulfill_brief.correlation',
      source: 'task_input',
      header: 'Correlation',
      body: correlation,
    },
    {
      id: 'fulfill_brief.workspace',
      source: 'workspace',
      header: 'Workspace',
      body: workspace,
    },
    {
      id: 'fulfill_brief.workflow',
      source: 'static',
      header: 'Workflow',
      body: workflow,
    },
    {
      id: 'fulfill_brief.verification',
      source: 'verification',
      body: buildSelfVerificationBlock(ctx.taskId),
    },
    {
      id: 'fulfill_brief.final_output',
      source: 'final_output',
      body: buildFinalOutputBlock({
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
    },
  ];

  return assembleTaskPrompt('fulfill_brief', sections);
}
