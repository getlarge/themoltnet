import { createOrchestrationAbsurdApp } from '@moltnet/orchestration';
import type { Absurd } from 'absurd-sdk';

import type { IssueLifecycleDeps, IssueLifecycleInput } from './types.js';
import { runGithubIssueLifecycle } from './workflow.js';

export const GITHUB_ISSUE_LIFECYCLE_TASK = 'github_issue_lifecycle';

export function createIssueLifecycleAbsurdApp(args: {
  databaseUrl: string;
  queueName?: string;
  deps: IssueLifecycleDeps;
}): Absurd {
  return createOrchestrationAbsurdApp<IssueLifecycleInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName ?? 'issue-lifecycle',
    taskName: GITHUB_ISSUE_LIFECYCLE_TASK,
    defaultMaxAttempts: 3,
    run: (params, ctx) => runGithubIssueLifecycle(params, args.deps, ctx),
  });
}
