import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  type Task,
} from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

import { buildAssessBriefPrompt } from './assess-brief.js';
import { buildFulfillBriefPrompt } from './fulfill-brief.js';

export * from './assess-brief.js';
export * from './fulfill-brief.js';

/**
 * Context shared by all prompt builders. Concrete per-type context extras
 * (like the `assess_brief` target bundle) are passed through `extras`.
 */
export interface PromptContext {
  diaryId: string;
  taskId: string;
  extras?: Record<string, unknown>;
}

/**
 * Resolve the correct prompt builder for `task.task_type` and invoke it.
 * Throws if the type is unknown or the input fails TypeBox validation.
 */
export function buildPromptForTask(task: Task, ctx: PromptContext): string {
  switch (task.task_type) {
    case FULFILL_BRIEF_TYPE: {
      if (!Value.Check(FulfillBriefInput, task.input)) {
        const errors = [...Value.Errors(FulfillBriefInput, task.input)];
        throw new Error(
          `fulfill_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildFulfillBriefPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
    }

    case ASSESS_BRIEF_TYPE: {
      if (!Value.Check(AssessBriefInput, task.input)) {
        const errors = [...Value.Errors(AssessBriefInput, task.input)];
        throw new Error(
          `assess_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      const target = ctx.extras?.target as
        | Parameters<typeof buildAssessBriefPrompt>[1]['target']
        | undefined;
      if (!target) {
        throw new Error(
          'assess_brief prompt requires ctx.extras.target (resolved fulfill_brief summary)',
        );
      }
      return buildAssessBriefPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        target,
      });
    }

    default:
      throw new Error(
        `No prompt builder registered for task_type="${task.task_type}"`,
      );
  }
}
