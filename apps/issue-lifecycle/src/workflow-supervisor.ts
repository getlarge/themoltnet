import type { normalizeLifecycleInput } from './task-factory.js';
import { buildSupervisorRecommendationTask } from './task-factory.js';
import type {
  AcceptedTaskResult,
  IssueLifecycleDeps,
  SdkTask,
  SdkTaskAttempt,
  SupervisorAction,
  WorkflowContext,
} from './types.js';
import {
  logCreatedTask,
  type TaskOutcome,
  waitForAcceptedTask,
  waitForTaskOutcome,
} from './workflow-steps.js';

const RECOVERY_ACTIONS: SupervisorAction[] = [
  'stop_blocked',
  'abort',
  'wait_for_human',
  'retry_step',
  'spawn_replacement_step',
];

type NormalizedLifecycleInput = ReturnType<typeof normalizeLifecycleInput>;

async function taskSnapshot(args: {
  tasks: IssueLifecycleDeps['tasks'];
  task: SdkTask;
  attempts: SdkTaskAttempt[];
}): Promise<Record<string, unknown>> {
  return {
    id: args.task.id,
    title: args.task.title,
    status: args.task.status,
    acceptedAttemptN: args.task.acceptedAttemptN,
    attempts: await Promise.all(
      args.attempts.map(async (attempt) => ({
        attemptN: attempt.attemptN,
        status: attempt.status,
        error: attempt.error,
        outputCid: attempt.outputCid,
        output: attempt.output,
        messages: args.tasks.listMessages
          ? await args.tasks.listMessages(args.task.id, attempt.attemptN)
          : [],
      })),
    ),
  };
}

async function recommendationSnapshot(args: {
  input: NormalizedLifecycleInput;
  issue: Awaited<ReturnType<IssueLifecycleDeps['github']['getIssue']>>;
  step: string;
  reason: string;
  outcome: Exclude<TaskOutcome, { kind: 'accepted' }>;
  deps: IssueLifecycleDeps;
  allowedActions: SupervisorAction[];
}): Promise<Record<string, unknown>> {
  const attempts =
    args.outcome.kind === 'failed'
      ? args.outcome.attempts
      : [args.outcome.attempt];
  return {
    correlationId: args.input.correlationId,
    step: args.step,
    reason: args.reason,
    issue: {
      repo: args.input.repo,
      number: args.issue.number,
      title: args.issue.title,
      labels: args.issue.labels,
    },
    task: await taskSnapshot({
      tasks: args.deps.tasks,
      task: args.outcome.task,
      attempts,
    }),
    budgets: {
      maxReviewRounds: args.input.maxReviewRounds,
      maxImplementationRetries: args.input.maxImplementationRetries,
    },
    allowedActions: args.allowedActions,
  };
}

async function requestSupervisorRecommendation(args: {
  input: NormalizedLifecycleInput;
  issue: Awaited<ReturnType<IssueLifecycleDeps['github']['getIssue']>>;
  step: string;
  reason: string;
  outcome: Exclude<TaskOutcome, { kind: 'accepted' }>;
  deps: IssueLifecycleDeps;
  ctx: WorkflowContext;
  allowedActions?: SupervisorAction[];
}): Promise<AcceptedTaskResult> {
  const allowedActions = args.allowedActions ?? RECOVERY_ACTIONS;
  const snapshot = await args.ctx.step(
    `supervisor.${args.step}.snapshot`,
    async () =>
      recommendationSnapshot({
        input: args.input,
        issue: args.issue,
        step: args.step,
        reason: args.reason,
        outcome: args.outcome,
        deps: args.deps,
        allowedActions,
      }),
  );
  const supervisorTask = await args.ctx.step(
    `task.supervisor.${args.step}.create`,
    async () => {
      const body = await buildSupervisorRecommendationTask({
        input: args.input,
        issue: args.issue,
        step: args.step,
        reason: args.reason,
        snapshot,
        allowedActions,
      });
      const task = await args.deps.tasks.createTask(body);
      logCreatedTask(args.deps.logger, `supervisor.${args.step}`, task);
      return task;
    },
  );
  return waitForAcceptedTask(
    supervisorTask.id,
    args.deps.tasks,
    args.ctx,
    args.input.pollIntervalSec,
    args.deps.logger,
    `supervisor.${args.step}`,
  );
}

function applySupervisorRecommendation(args: {
  step: string;
  reason: string;
  recommendation: AcceptedTaskResult;
  allowedActions: SupervisorAction[];
}): never {
  const state = args.recommendation.state;
  const action = state.allowedNextAction;
  if (!action || !args.allowedActions.includes(action)) {
    throw new Error(
      `lifecycle supervisor produced unsupported action ${String(action)} for ${args.step}`,
    );
  }
  const message = state.humanMessage ?? state.summary;
  throw new Error(
    [
      `lifecycle supervisor recommended ${action} for ${args.step}`,
      `reason: ${args.reason}`,
      `classification: ${state.classification ?? 'unknown'}`,
      `confidence: ${state.confidence ?? 'unknown'}`,
      `message: ${message}`,
    ].join('; '),
  );
}

export async function waitForLifecycleTask(args: {
  taskId: string;
  step: string;
  description: string;
  input: NormalizedLifecycleInput;
  issue: Awaited<ReturnType<IssueLifecycleDeps['github']['getIssue']>>;
  deps: IssueLifecycleDeps;
  ctx: WorkflowContext;
}): Promise<AcceptedTaskResult> {
  const outcome = await waitForTaskOutcome(
    args.taskId,
    args.deps.tasks,
    args.ctx,
    args.input.pollIntervalSec,
    args.deps.logger,
    args.description,
  );
  if (outcome.kind === 'accepted') return outcome.result;
  const recommendation = await requestSupervisorRecommendation({
    input: args.input,
    issue: args.issue,
    step: args.step,
    reason: outcome.reason,
    outcome,
    deps: args.deps,
    ctx: args.ctx,
  });
  return applySupervisorRecommendation({
    step: args.step,
    reason: outcome.reason,
    recommendation,
    allowedActions: RECOVERY_ACTIONS,
  });
}
