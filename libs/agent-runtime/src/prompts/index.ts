import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  CURATE_PACK_TYPE,
  CuratePackInput,
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  JUDGE_EVAL_ATTEMPT_TYPE,
  JUDGE_PACK_TYPE,
  JudgeEvalAttemptInput,
  JudgePackInput,
  PR_REVIEW_TYPE,
  PrReviewInput,
  RENDER_PACK_TYPE,
  RenderPackInput,
  RUN_EVAL_TYPE,
  RunEvalInput,
  type Task,
} from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

import { buildAssessBriefUserPrompt } from './assess-brief.js';
import { buildCuratePackUserPrompt } from './curate-pack.js';
import { buildFulfillBriefUserPrompt } from './fulfill-brief.js';
import { buildJudgeEvalAttemptUserPrompt } from './judge-eval-attempt.js';
import { buildJudgePackUserPrompt } from './judge-pack.js';
import { buildPrReviewUserPrompt } from './pr-review.js';
import { buildRenderPackUserPrompt } from './render-pack.js';
import { buildRunEvalUserPrompt } from './run-eval.js';

export * from './assess-brief.js';
export * from './curate-pack.js';
export * from './fulfill-brief.js';
export * from './judge-eval-attempt.js';
export * from './judge-pack.js';
export * from './pr-review.js';
export * from './render-pack.js';
export * from './run-eval.js';

/**
 * Context shared by all task user-prompt builders. Per-type extras can
 * ride through `extras` if a builder ever needs out-of-band data;
 * today none do — judges and curators fetch their own dependent data
 * via MoltNet tools at run time, which keeps the daemon
 * task-type-agnostic.
 */
export interface TaskUserPromptContext {
  diaryId: string;
  taskId: string;
  workspace?: {
    mode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
    branch?: string | null;
    attached?: boolean;
    source?: 'producer_attachment' | 'producer_copy';
  };
  extras?: Record<string, unknown>;
}

/**
 * Resolve the correct user-prompt builder for `task.taskType` and
 * invoke it. Throws if the type is unknown or the input fails TypeBox
 * validation.
 *
 * Role note: the returned string is delivered as the **first user
 * message** of the agent's session (pi-coding-agent's
 * `session.prompt(text)` puts text in the user role). The system
 * prompt is built separately by pi from `appendSystemPrompt` (the
 * runtime instructor lives there). Builders here are free-form Markdown
 * for the user turn; they don't replace or prepend to the system
 * prompt.
 */
export function buildTaskUserPrompt(
  task: Task,
  ctx: TaskUserPromptContext,
): string {
  switch (task.taskType) {
    case FULFILL_BRIEF_TYPE: {
      if (!Value.Check(FulfillBriefInput, task.input)) {
        const errors = [...Value.Errors(FulfillBriefInput, task.input)];
        throw new Error(
          `fulfill_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildFulfillBriefUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        correlationId: task.correlationId,
        workspace: ctx.workspace,
      });
    }

    case ASSESS_BRIEF_TYPE: {
      if (!Value.Check(AssessBriefInput, task.input)) {
        const errors = [...Value.Errors(AssessBriefInput, task.input)];
        throw new Error(
          `assess_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildAssessBriefUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
    }

    case CURATE_PACK_TYPE: {
      if (!Value.Check(CuratePackInput, task.input)) {
        const errors = [...Value.Errors(CuratePackInput, task.input)];
        throw new Error(
          `curate_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildCuratePackUserPrompt(task.input, {
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
      return buildRenderPackUserPrompt(task.input, {
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
      return buildJudgePackUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
    }

    case JUDGE_EVAL_ATTEMPT_TYPE: {
      if (!Value.Check(JudgeEvalAttemptInput, task.input)) {
        const errors = [...Value.Errors(JudgeEvalAttemptInput, task.input)];
        throw new Error(
          `judge_eval_attempt input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildJudgeEvalAttemptUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
    }

    case PR_REVIEW_TYPE: {
      if (!Value.Check(PrReviewInput, task.input)) {
        const errors = [...Value.Errors(PrReviewInput, task.input)];
        throw new Error(
          `pr_review input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildPrReviewUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
    }

    case RUN_EVAL_TYPE: {
      if (!Value.Check(RunEvalInput, task.input)) {
        const errors = [...Value.Errors(RunEvalInput, task.input)];
        throw new Error(
          `run_eval input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      return buildRunEvalUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        correlationId: task.correlationId,
      });
    }

    default:
      throw new Error(
        `No prompt builder registered for taskType="${task.taskType}"`,
      );
  }
}
