import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  type ContextRef,
  CURATE_PACK_TYPE,
  CuratePackInput,
  FREEFORM_TYPE,
  FreeformInput,
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
import { Value } from 'typebox/value';

import type { AssembledPrompt } from './assemble.js';
import { buildAssessBriefUserPrompt } from './assess-brief.js';
import { buildCuratePackUserPrompt } from './curate-pack.js';
import { buildFreeformUserPrompt } from './freeform.js';
import { buildFulfillBriefUserPrompt } from './fulfill-brief.js';
import { buildJudgeEvalAttemptUserPrompt } from './judge-eval-attempt.js';
import { buildJudgePackUserPrompt } from './judge-pack.js';
import { buildPrReviewUserPrompt } from './pr-review.js';
import { buildRenderPackUserPrompt } from './render-pack.js';
import { buildRunEvalUserPrompt } from './run-eval.js';
import { appendTaskContractFacts } from './task-contract-facts.js';

export * from './assemble.js';
export * from './assess-brief.js';
export * from './curate-pack.js';
export * from './freeform.js';
export * from './fulfill-brief.js';
export * from './judge-eval-attempt.js';
export * from './judge-pack.js';
export * from './pr-review.js';
export * from './proactive-memory.js';
export * from './render-pack.js';
export * from './run-eval.js';
export * from './task-contract-facts.js';

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
  /**
   * Effective context selected for this attempt after the runtime has merged
   * runtime-profile defaults with task-scoped context. Prompt builders that
   * mention context availability should use this value instead of assuming
   * only `task.input.context` exists.
   */
  effectiveRuntimeContext?: readonly ContextRef[];
  /**
   * Resolved source-task material for `freeform.continueFrom`
   * continuations. Caller (the daemon runtime) fetches the source
   * attempt's output via the API client and projects `summary` +
   * `artifacts` into this shape. Only consumed by the freeform builder;
   * other builders ignore it. Absent for non-continuation tasks.
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

/**
 * Resolve the correct user-prompt builder for `task.taskType` and
 * invoke it. Throws if the type is unknown or the input fails TypeBox
 * validation.
 *
 * Role note: the returned string is delivered as the **first user
 * message** of the agent's session (pi-coding-agent's
 * `session.prompt(text)` puts text in the user role). The system
 * prompt is built separately by pi from `appendSystemPrompt` (the
 * runtime kernel lives there). Builders here are free-form Markdown
 * for the user turn; they don't replace or prepend to the system
 * prompt.
 */
export function buildTaskUserPrompt(
  task: Task,
  ctx: TaskUserPromptContext,
): AssembledPrompt {
  let prompt: AssembledPrompt;
  switch (task.taskType) {
    case FREEFORM_TYPE: {
      if (!Value.Check(FreeformInput, task.input)) {
        const errors = [...Value.Errors(FreeformInput, task.input)];
        throw new Error(
          `freeform input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildFreeformUserPrompt(task.input, {
        taskId: ctx.taskId,
        priorContext: ctx.priorContext,
      });
      break;
    }

    case FULFILL_BRIEF_TYPE: {
      if (!Value.Check(FulfillBriefInput, task.input)) {
        const errors = [...Value.Errors(FulfillBriefInput, task.input)];
        throw new Error(
          `fulfill_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildFulfillBriefUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        correlationId: task.correlationId,
        workspace: ctx.workspace,
      });
      break;
    }

    case ASSESS_BRIEF_TYPE: {
      if (!Value.Check(AssessBriefInput, task.input)) {
        const errors = [...Value.Errors(AssessBriefInput, task.input)];
        throw new Error(
          `assess_brief input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildAssessBriefUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
      break;
    }

    case CURATE_PACK_TYPE: {
      if (!Value.Check(CuratePackInput, task.input)) {
        const errors = [...Value.Errors(CuratePackInput, task.input)];
        throw new Error(
          `curate_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildCuratePackUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
      break;
    }

    case RENDER_PACK_TYPE: {
      if (!Value.Check(RenderPackInput, task.input)) {
        const errors = [...Value.Errors(RenderPackInput, task.input)];
        throw new Error(
          `render_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildRenderPackUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
      break;
    }

    case JUDGE_PACK_TYPE: {
      if (!Value.Check(JudgePackInput, task.input)) {
        const errors = [...Value.Errors(JudgePackInput, task.input)];
        throw new Error(
          `judge_pack input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildJudgePackUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
      });
      break;
    }

    case JUDGE_EVAL_ATTEMPT_TYPE: {
      if (!Value.Check(JudgeEvalAttemptInput, task.input)) {
        const errors = [...Value.Errors(JudgeEvalAttemptInput, task.input)];
        throw new Error(
          `judge_eval_attempt input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildJudgeEvalAttemptUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
      break;
    }

    case PR_REVIEW_TYPE: {
      if (!Value.Check(PrReviewInput, task.input)) {
        const errors = [...Value.Errors(PrReviewInput, task.input)];
        throw new Error(
          `pr_review input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildPrReviewUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        workspace: ctx.workspace,
      });
      break;
    }

    case RUN_EVAL_TYPE: {
      if (!Value.Check(RunEvalInput, task.input)) {
        const errors = [...Value.Errors(RunEvalInput, task.input)];
        throw new Error(
          `run_eval input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
        );
      }
      prompt = buildRunEvalUserPrompt(task.input, {
        diaryId: ctx.diaryId,
        taskId: ctx.taskId,
        correlationId: task.correlationId,
        effectiveRuntimeContext: ctx.effectiveRuntimeContext,
      });
      break;
    }

    default:
      throw new Error(
        `No prompt builder registered for taskType="${task.taskType}"`,
      );
  }

  return appendTaskContractFacts(prompt, task);
}
