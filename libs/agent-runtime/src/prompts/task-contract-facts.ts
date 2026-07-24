import { getTaskSubmissionSchema, type Task } from '@moltnet/tasks';
import type { TSchema } from 'typebox';

import type { AssembledPrompt, PromptSectionTrace } from './assemble.js';

type ObjectSchema = TSchema & {
  properties?: Record<string, unknown>;
};

function hasSuccessCriteria(input: unknown): input is {
  successCriteria: unknown;
} {
  return (
    input !== null &&
    typeof input === 'object' &&
    'successCriteria' in input &&
    (input as { successCriteria?: unknown }).successCriteria !== undefined
  );
}

function submissionAcceptsVerification(taskType: string): boolean {
  const schema = getTaskSubmissionSchema(taskType) as ObjectSchema | null;
  return schema?.properties?.verification !== undefined;
}

/**
 * Add only the dynamic contract facts that a producer cannot infer from its
 * task-specific prompt: the declared success criteria and the immutable input
 * CID its verification must cite. This is deliberately not a workflow block;
 * the submit tool owns the output shape and profiles own optional behavior.
 */
export function appendTaskContractFacts(
  prompt: AssembledPrompt,
  task: Task,
): AssembledPrompt {
  if (
    !hasSuccessCriteria(task.input) ||
    !submissionAcceptsVerification(task.taskType)
  ) {
    return prompt;
  }

  const criteriaJson = JSON.stringify(task.input.successCriteria, null, 2);
  const body = [
    `Task input CID: \`${task.inputCid}\``,
    '',
    'These typed criteria are task facts. Assess the completed work against',
    'them before calling the submit-output tool. Its `verification` payload',
    'must cite exactly this input CID and report each applicable criterion',
    'honestly; a failing or skipped result is valid when that is the evidence.',
    '',
    '```json',
    criteriaJson,
    '```',
  ].join('\n');
  const trace: PromptSectionTrace = {
    id: `${task.taskType}.success_criteria`,
    source: 'task_contract',
    header: 'Success criteria',
    char_count: body.length,
  };
  return {
    ...prompt,
    text: `${prompt.text}\n\n## Success criteria\n\n${body}`,
    trace: [...prompt.trace, trace],
  };
}
