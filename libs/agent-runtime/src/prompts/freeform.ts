import type { FreeformInput } from '@moltnet/tasks';

import {
  type AssembledPrompt,
  assembleTaskPrompt,
  type PromptSection,
} from './assemble.js';
import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  taskId: string;
  /**
   * Source-task material to inline into the prompt when this is a
   * continuation. Caller computes and passes; the prompt builder only
   * decides how to render (inlining threshold, manifest fallback).
   */
  priorContext?: {
    summary?: string;
    artifacts?: ReadonlyArray<{
      kind: string;
      title: string;
      body?: string;
    }>;
  };
}

const INLINE_ARTIFACT_THRESHOLD = 16 * 1024;
const TOTAL_INLINE_BUDGET = 32 * 1024;

function buildPriorContextSection(
  priorContext: Ctx['priorContext'],
): string | null {
  if (!priorContext) return null;
  const lines: string[] = ['# Prior context', ''];
  if (priorContext.summary) {
    lines.push('## Summary', priorContext.summary, '');
  }
  let inlineUsed = priorContext.summary?.length ?? 0;
  priorContext.artifacts?.forEach((art, i) => {
    const bodyLen = art.body?.length ?? 0;
    const inlinable =
      art.body &&
      bodyLen < INLINE_ARTIFACT_THRESHOLD &&
      inlineUsed + bodyLen < TOTAL_INLINE_BUDGET;
    if (inlinable) {
      lines.push(`## Artifact ${i}: ${art.title} (${art.kind})`, art.body!, '');
      inlineUsed += bodyLen;
    } else {
      lines.push(
        `## Artifact ${i} (pointer): kind: ${art.kind}, title: ${art.title}`,
        '(body omitted; use tasks_get to retrieve full content)',
        '',
      );
    }
  });
  // Trim trailing blank line so the assembler controls inter-section spacing.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export function buildFreeformUserPrompt(
  input: FreeformInput,
  ctx: Ctx,
): AssembledPrompt {
  const header = [
    '# Freeform Task Agent',
    '',
    'You are handling an exploratory MoltNet task that does not yet have a',
    'more specific execution contract. Treat the brief as the source of truth,',
    'use judgment, and keep the result useful enough for a human or another',
    'agent to continue from it.',
    '',
    `Task id: \`${ctx.taskId}\``,
  ].join('\n');

  const expectedOutput = input.expectedOutput ?? '';
  const constraints = input.constraints?.length
    ? input.constraints.map((constraint) => `- ${constraint}`).join('\n')
    : '';
  const suggestedTaskType = input.suggestedTaskType
    ? [
        `The proposer suggested task type \`${input.suggestedTaskType}\`.`,
        'Use it as a hint, not as a contract.',
      ].join('\n')
    : '';

  const workflow = [
    '1. Clarify the real objective from the brief before acting.',
    '2. Gather enough context to avoid guessing.',
    '3. Complete the requested work when it is safe and bounded.',
    '4. If the request reveals a recurring task shape, include a',
    '   `proposedTaskType` in the final output with a concise rationale.',
  ].join('\n');

  const sections: PromptSection[] = [
    { id: 'freeform.header', source: 'header', body: header },
    {
      id: 'freeform.brief',
      source: 'task_input',
      header: 'Brief',
      body: input.brief,
    },
    {
      id: 'freeform.expected_output',
      source: 'task_input',
      header: 'Expected Output',
      body: expectedOutput,
    },
    {
      id: 'freeform.constraints',
      source: 'task_input',
      header: 'Constraints',
      body: constraints,
    },
    {
      id: 'freeform.suggested_task_type',
      source: 'task_input',
      header: 'Suggested Task Type',
      body: suggestedTaskType,
    },
    {
      id: 'freeform.workflow',
      source: 'static',
      header: 'Workflow',
      body: workflow,
    },
    {
      id: 'freeform.verification',
      source: 'verification',
      body: buildSelfVerificationBlock(ctx.taskId),
    },
    {
      id: 'freeform.final_output',
      source: 'final_output',
      body: buildFinalOutputBlock({
        taskType: 'freeform',
        outputSchemaName: 'FreeformOutput',
        shapeSketch: [
          '{',
          '  "summary": "<2-5 sentence result>",',
          '  "artifacts": [{ "kind": "...", "title": "...", "description": "...", "body": "<inline content up to 64 KiB; preferred for textual output so it persists with the task>", "url": "...", "path": "<worktree-ephemeral; not persisted after completion>" }],',
          '  "proposedTaskType": { "name": "...", "rationale": "...", "inputShape": {}, "outputShape": {} },',
          '  "diaryEntryIds": ["..."],',
          '  "verification": <required iff input.successCriteria; see Self-verification>',
          '}',
        ].join('\n'),
      }),
    },
  ];

  const priorContextBody = buildPriorContextSection(ctx.priorContext);
  if (priorContextBody) {
    sections.splice(
      sections.findIndex((s) => s.id === 'freeform.workflow') + 1,
      0,
      {
        id: 'freeform.prior_context',
        source: 'task_input',
        body: priorContextBody,
      },
    );
  }

  return assembleTaskPrompt('freeform', sections);
}
