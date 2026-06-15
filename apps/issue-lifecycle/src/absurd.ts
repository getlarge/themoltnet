import { Absurd, type JsonValue, type TaskContext } from 'absurd-sdk';

import type {
  IssueLifecycleDeps,
  IssueLifecycleInput,
  WorkflowContext,
} from './types.js';
import { runGithubIssueLifecycle } from './workflow.js';

export const GITHUB_ISSUE_LIFECYCLE_TASK = 'github_issue_lifecycle';

function asWorkflowContext(ctx: TaskContext): WorkflowContext {
  return {
    step(name, fn) {
      return ctx.step(name, fn);
    },
    sleepFor(name, seconds) {
      return ctx.sleepFor(name, seconds);
    },
    awaitEvent(eventName, options) {
      return ctx.awaitEvent(eventName, options);
    },
    emitEvent(eventName, payload) {
      return ctx.emitEvent(eventName, payload as JsonValue | undefined);
    },
  };
}

export function createIssueLifecycleAbsurdApp(args: {
  databaseUrl: string;
  queueName?: string;
  deps: IssueLifecycleDeps;
}): Absurd {
  const app = new Absurd({
    db: args.databaseUrl,
    queueName: args.queueName ?? 'issue-lifecycle',
  });

  app.registerTask<IssueLifecycleInput, JsonValue>(
    {
      name: GITHUB_ISSUE_LIFECYCLE_TASK,
      defaultMaxAttempts: 3,
    },
    async (params, ctx) =>
      (await runGithubIssueLifecycle(
        params,
        args.deps,
        asWorkflowContext(ctx),
      )) as unknown as JsonValue,
  );

  return app;
}
