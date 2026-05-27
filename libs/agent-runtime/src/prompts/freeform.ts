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
    '5. If the work should be split or continued, include `followUpTasks`.',
  ].join('\n');

  const sections: PromptSection[] = [
    { id: 'freeform.header', source: 'header', body: header },
    {
      id: 'freeform.title',
      source: 'task_input',
      header: 'Title',
      body: input.title ?? '',
    },
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
          '  "artifacts": [{ "kind": "...", "title": "...", "description": "...", "url": "...", "path": "..." }],',
          '  "proposedTaskType": { "name": "...", "rationale": "...", "inputShape": {}, "outputShape": {} },',
          '  "followUpTasks": [{ "title": "...", "brief": "...", "suggestedTaskType": "..." }],',
          '  "diaryEntryIds": ["..."],',
          '  "verification": <required iff input.successCriteria; see Self-verification>',
          '}',
        ].join('\n'),
      }),
    },
  ];

  return assembleTaskPrompt('freeform', sections);
}
