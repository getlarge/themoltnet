import {
  createTaskStep,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import { prepareBrief, type PreparedBrief } from './brief.js';

export interface BriefPresentation {
  presentedAt: string;
  issueDigest: string;
  briefDigest: string;
  commentId: number;
}
export interface PreparationInput {
  authoring: Parameters<typeof prepareBrief>[0];
  issueDigest: string;
}

/** Persist the approved-to-be task request, then publish it for human admission. */
export async function runPreparation(
  input: PreparationInput,
  port: {
    present(
      brief: PreparedBrief,
      issueDigest: string,
      key: string,
    ): Promise<BriefPresentation | null>;
  },
  ctx: WorkflowContext,
): Promise<{ brief: PreparedBrief; presentation: BriefPresentation | null }> {
  if (!ctx.executionId)
    throw new Error('Preparation requires a stable execution identity');
  const frozen = await ctx.step('preparation.brief', () =>
    Promise.resolve({
      brief: prepareBrief(input.authoring),
      issueDigest: input.issueDigest,
    }),
  );
  const presentation = await createTaskStep(
    ctx,
    'preparation.present',
    async ({ idempotencyKey }) => {
      if (!idempotencyKey)
        throw new Error('Missing preparation operation identity');
      const result = await port.present(
        frozen.brief,
        frozen.issueDigest,
        idempotencyKey,
      );
      if (
        result &&
        (result.briefDigest !== frozen.brief.digest ||
          result.issueDigest !== frozen.issueDigest ||
          !Number.isFinite(Date.parse(result.presentedAt)) ||
          !Number.isSafeInteger(result.commentId) ||
          result.commentId <= 0)
      )
        throw new Error('Invalid brief presentation receipt');
      return result;
    },
  );
  return { brief: frozen.brief, presentation };
}
