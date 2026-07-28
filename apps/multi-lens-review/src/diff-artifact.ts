import type { Agent } from '@themoltnet/sdk';

import type { ReviewDiffArtifact } from './types.js';

export const MAX_REVIEW_DIFF_BYTES = 128 * 1024;
export const REVIEW_DIFF_TITLE = 'pull-request.diff';
export const REVIEW_DIFF_CONTENT_TYPE = 'text/x-diff';

export function assertReviewDiffWithinLimit(diff: string): void {
  const size = Buffer.byteLength(diff, 'utf8');
  if (size > MAX_REVIEW_DIFF_BYTES) {
    throw new Error(
      `review diff exceeds the ${MAX_REVIEW_DIFF_BYTES}-byte limit (got ${size})`,
    );
  }
}

/** Store the untrusted diff once; task creation binds this CID atomically. */
export async function stageReviewDiff(
  agent: Agent,
  teamId: string,
  diff: string,
): Promise<ReviewDiffArtifact> {
  assertReviewDiffWithinLimit(diff);
  const staged = await agent.tasks.artifacts.stage(
    Buffer.from(diff, 'utf8'),
    { contentType: REVIEW_DIFF_CONTENT_TYPE },
    { teamId },
  );
  return {
    cid: staged.cid,
    title: REVIEW_DIFF_TITLE,
    contentType: REVIEW_DIFF_CONTENT_TYPE,
  };
}
