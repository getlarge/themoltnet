import type { FulfillBriefInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';

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
  const { brief, seedFiles } = input;

  const header = [
    '# Fulfill Brief Agent',
    '',
    'You are a software engineering agent working in a sandboxed environment.',
    'Use the current working directory as the task workspace.',
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
  ];

  return assembleTaskPrompt('fulfill_brief', sections);
}
