import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import type { Absurd } from 'absurd-sdk';

import type {
  MultiLensReviewDeps,
  MultiLensReviewDurableOutput,
  MultiLensReviewInput,
  MultiLensReviewOutput,
} from './types.js';
import { runMultiLensReview } from './workflow.js';

export const MULTI_LENS_REVIEW_TASK = 'multi_lens_review';

/**
 * Strip remotely stored agent payloads before Absurd persists the workflow
 * result. The accepted task/output/artifact references are sufficient to
 * hydrate them later.
 */
export function durableMultiLensReviewOutput(
  output: MultiLensReviewOutput,
): MultiLensReviewDurableOutput {
  return {
    correlationId: output.correlationId,
    outcome: output.outcome,
    phaseOutputs: output.phaseOutputs,
    diagnostics: output.diagnostics,
  };
}

export function createMultiLensReviewAbsurdApp(args: {
  databaseUrl: string;
  queueName?: string;
  deps: MultiLensReviewDeps;
}): Absurd {
  return createOrchestrationAbsurdApp<MultiLensReviewInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName ?? 'multi-lens-review',
    taskName: MULTI_LENS_REVIEW_TASK,
    logger: args.deps.logger,
    defaultMaxAttempts: 3,
    run: async (params, ctx) =>
      durableMultiLensReviewOutput(
        await runMultiLensReview(params, args.deps, ctx),
      ),
  });
}
