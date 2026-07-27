import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import type { Absurd } from 'absurd-sdk';

import type { ParallelBriefsDeps, ParallelBriefsInput } from './types.js';
import { runParallelBriefs } from './workflow.js';

export const PARALLEL_BRIEFS_TASK = 'parallel_briefs';

export function createParallelBriefsAbsurdApp(args: {
  databaseUrl: string;
  queueName?: string;
  deps: ParallelBriefsDeps;
}): Absurd {
  return createOrchestrationAbsurdApp<ParallelBriefsInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName ?? 'parallel-briefs',
    taskName: PARALLEL_BRIEFS_TASK,
    defaultMaxAttempts: 3,
    run: (params, ctx) => runParallelBriefs(params, args.deps, ctx),
  });
}
