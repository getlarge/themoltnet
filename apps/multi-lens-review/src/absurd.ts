import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import type { Absurd } from 'absurd-sdk';

import type { MultiLensReviewDeps, MultiLensReviewInput } from './types.js';
import { runMultiLensReview } from './workflow.js';

export const MULTI_LENS_REVIEW_TASK = 'multi_lens_review';

export function createMultiLensReviewAbsurdApp(args: {
  databaseUrl: string;
  queueName?: string;
  deps: MultiLensReviewDeps;
}): Absurd {
  return createOrchestrationAbsurdApp<MultiLensReviewInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName ?? 'multi-lens-review',
    taskName: MULTI_LENS_REVIEW_TASK,
    defaultMaxAttempts: 3,
    run: (params, ctx) => runMultiLensReview(params, args.deps, ctx),
  });
}
