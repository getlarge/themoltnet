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
];

const TRANSIENT_ERROR_RE =
  /\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|timeout|timed out|orphaned|lease_expired|network|DNS|registry\.npmjs\.org)\b/i;

type NormalizedLifecycleInput = ReturnType<typeof normalizeLifecycleInput>;

const MAX_SNAPSHOT_STRING_LENGTH = 2_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 20;
const REDACTED = '[redacted]';

export class SupervisorRecommendationError extends Error {
  constructor(
    readonly details: {
      step: string;
      reason: string;
      action: SupervisorAction;
      classification: string;
      confidence: string;
      message: string;
      taskId: string;
      attemptN: number;
    },
  ) {
    super(
      [
        `lifecycle supervisor recommended ${details.action} for ${details.step}`,
        `reason: ${details.reason}`,
        `classification: ${details.classification}`,
        `confidence: ${details.confidence}`,
        `message: ${details.message}`,
      ].join('; '),
    );
    this.name = 'SupervisorRecommendationError';
  }
}

function shouldRedactKey(key: string): boolean {
  return /(api[_-]?key|auth|credential|password|secret|token)/i.test(key);
}

function sanitizeSnapshotValue(value: unknown, key = ''): unknown {
  if (shouldRedactKey(key)) return REDACTED;
  if (typeof value === 'string') {
    return value.length > MAX_SNAPSHOT_STRING_LENGTH
      ? `${value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)}...[truncated ${value.length - MAX_SNAPSHOT_STRING_LENGTH} chars]`
      : value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const visible = value
      .slice(0, MAX_SNAPSHOT_ARRAY_LENGTH)
      .map((item) => sanitizeSnapshotValue(item));
    return value.length > MAX_SNAPSHOT_ARRAY_LENGTH
      ? [
          ...visible,
          `[truncated ${value.length - MAX_SNAPSHOT_ARRAY_LENGTH} items]`,
        ]
      : visible;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeSnapshotValue(entryValue, entryKey),
      ]),
    );
  }
  return `[${typeof value}]`;
}

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
        error: sanitizeSnapshotValue(attempt.error, 'error'),
        outputCid: attempt.outputCid,
        output: sanitizeSnapshotValue(attempt.output, 'output'),
        messages: args.tasks.listMessages
          ? sanitizeSnapshotValue(
              await args.tasks.listMessages(args.task.id, attempt.attemptN),
              'messages',
            )
          : [],
      })),
    ),
  };
}

function hasRetryableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return false;
  if (typeof value === 'string') return TRANSIENT_ERROR_RE.test(value);
  if (Array.isArray(value))
    return value.some((item) => hasRetryableValue(item));
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, entryValue]) => {
      if (key === 'retryable' && entryValue === true) return true;
      return hasRetryableValue(entryValue);
    });
  }
  return false;
}

function retryPolicy(args: {
  outcome: Exclude<TaskOutcome, { kind: 'accepted' }>;
}): {
  maxAttempts: number;
  usedAttempts: number;
  remainingAttempts: number;
  transientFailure: boolean;
  retryStepAllowed: boolean;
  reason: string;
} {
  if (args.outcome.kind === 'invalid_output') {
    return {
      maxAttempts: args.outcome.task.maxAttempts,
      usedAttempts: args.outcome.attempt.attemptN,
      remainingAttempts: Math.max(
        0,
        args.outcome.task.maxAttempts - args.outcome.attempt.attemptN,
      ),
      transientFailure: false,
      retryStepAllowed: false,
      reason:
        'accepted output was invalid; retry requires human/domain judgment',
    };
  }
  const usedAttempts = args.outcome.attempts.length;
  const maxAttempts = args.outcome.task.maxAttempts;
  const remainingAttempts = Math.max(0, maxAttempts - usedAttempts);
  const transientFailure =
    hasRetryableValue(args.outcome.reason) ||
    args.outcome.attempts.some((attempt) => hasRetryableValue(attempt.error));
  const retryStepAllowed = remainingAttempts > 0 && transientFailure;
  return {
    maxAttempts,
    usedAttempts,
    remainingAttempts,
    transientFailure,
    retryStepAllowed,
    reason: retryStepAllowed
      ? 'transient failure evidence found and task attempt budget remains'
      : remainingAttempts <= 0
        ? 'task attempt budget exhausted'
        : transientFailure
          ? 'transient failure evidence found but no automatic retry action is available'
          : 'failure does not look transient or retryable',
  };
}

function recoveryActionsForOutcome(
  outcome: Exclude<TaskOutcome, { kind: 'accepted' }>,
): SupervisorAction[] {
  const actions = [...RECOVERY_ACTIONS];
  if (retryPolicy({ outcome }).retryStepAllowed) {
    actions.unshift('retry_step');
  }
  return actions;
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
  const retry = retryPolicy({ outcome: args.outcome });
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
    retryPolicy: retry,
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
  const allowedActions =
    args.allowedActions ?? recoveryActionsForOutcome(args.outcome);
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
  try {
    return await waitForAcceptedTask(
      supervisorTask.id,
      args.deps.tasks,
      args.ctx,
      args.input.pollIntervalSec,
      args.deps.logger,
      `supervisor.${args.step}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `supervisor task for ${args.step} failed after original failure "${args.reason}": ${message}`,
    );
  }
}

function applySupervisorRecommendation(args: {
  step: string;
  reason: string;
  recommendation: AcceptedTaskResult;
  allowedActions: SupervisorAction[];
}): never {
  const state = args.recommendation.state;
  const action = state.allowedNextAction;
  if (state.phase !== 'lifecycle_recommendation') {
    throw new Error(
      `lifecycle supervisor produced unexpected phase ${state.phase} for ${args.step}`,
    );
  }
  if (!action || !args.allowedActions.includes(action)) {
    throw new Error(
      `lifecycle supervisor produced unsupported action ${String(action)} for ${args.step}`,
    );
  }
  if (state.decision !== action) {
    throw new Error(
      `lifecycle supervisor decision ${state.decision} does not match allowedNextAction ${action} for ${args.step}`,
    );
  }
  if (state.targetStep !== args.step) {
    throw new Error(
      `lifecycle supervisor targetStep ${String(state.targetStep)} does not match ${args.step}`,
    );
  }
  const message = state.humanMessage ?? state.summary;
  throw new SupervisorRecommendationError({
    step: args.step,
    reason: args.reason,
    action,
    classification: state.classification ?? 'unknown',
    confidence: state.confidence ?? 'unknown',
    message,
    taskId: args.recommendation.task.id,
    attemptN: args.recommendation.attempt.attemptN,
  });
}

export async function waitForLifecycleTask(args: {
  taskId: string;
  step: string;
  description: string;
  input: NormalizedLifecycleInput;
  issue: Awaited<ReturnType<IssueLifecycleDeps['github']['getIssue']>>;
  deps: IssueLifecycleDeps;
  ctx: WorkflowContext;
  validate?: (result: AcceptedTaskResult) => string | null;
}): Promise<AcceptedTaskResult> {
  const outcome = await waitForTaskOutcome(
    args.taskId,
    args.deps.tasks,
    args.ctx,
    args.input.pollIntervalSec,
    args.deps.logger,
    args.description,
  );
  if (outcome.kind === 'accepted') {
    const invalidReason = args.validate?.(outcome.result);
    if (!invalidReason) return outcome.result;
    const recommendation = await requestSupervisorRecommendation({
      input: args.input,
      issue: args.issue,
      step: args.step,
      reason: invalidReason,
      outcome: {
        kind: 'invalid_output',
        task: outcome.result.task,
        attempt: outcome.result.attempt,
        reason: invalidReason,
      },
      deps: args.deps,
      ctx: args.ctx,
      allowedActions: RECOVERY_ACTIONS,
    });
    return applySupervisorRecommendation({
      step: args.step,
      reason: invalidReason,
      recommendation,
      allowedActions: RECOVERY_ACTIONS,
    });
  }
  const allowedActions = recoveryActionsForOutcome(outcome);
  const recommendation = await requestSupervisorRecommendation({
    input: args.input,
    issue: args.issue,
    step: args.step,
    reason: outcome.reason,
    outcome,
    deps: args.deps,
    ctx: args.ctx,
    allowedActions,
  });
  return applySupervisorRecommendation({
    step: args.step,
    reason: outcome.reason,
    recommendation,
    allowedActions,
  });
}
