import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  CURATE_PACK_TYPE,
  CuratePackInput,
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  JUDGE_PACK_TYPE,
  JudgePackInput,
  RENDER_PACK_TYPE,
  RenderPackInput,
  type Task,
} from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

import { buildAssessBriefPrompt } from './assess-brief.js';
import { buildCuratePackPrompt } from './curate-pack.js';
import { buildFulfillBriefPrompt } from './fulfill-brief.js';
import { buildJudgePackPrompt } from './judge-pack.js';
import { buildRenderPackPrompt } from './render-pack.js';

export * from './assess-brief.js';
export * from './curate-pack.js';
export * from './fulfill-brief.js';
export * from './judge-pack.js';
export * from './render-pack.js';

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
 * Resolve the correct prompt builder for `task.taskType` and invoke it.
 * Throws if the type is unknown or the input fails TypeBox validation.
 */
export function buildPromptForTask(task: Task, ctx: PromptContext): string {
  switch (task.taskType) {
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

    case CURATE_PACK_TYPE: {
      if (!Value.Check(CuratePackInput, task.input)) {
        const errors = [...Value.Errors(CuratePackInput, task.input)];
        throw new Error(
          `curate_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildCuratePackPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
    }

    case RENDER_PACK_TYPE: {
      if (!Value.Check(RenderPackInput, task.input)) {
        const errors = [...Value.Errors(RenderPackInput, task.input)];
        throw new Error(
          `render_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildRenderPackPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
    }

    case JUDGE_PACK_TYPE: {
      if (!Value.Check(JudgePackInput, task.input)) {
        const errors = [...Value.Errors(JudgePackInput, task.input)];
        throw new Error(
          `judge_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildJudgePackPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
    }

    default:
      throw new Error(
        `No prompt builder registered for taskType="${task.taskType}"`,
      );
  }
}
