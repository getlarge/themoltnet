import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { waitForTaskOutcome } from './await-engine.js';
import { isWorkflowInterruption } from './interruption.js';
import { createTaskStep } from './task-step.js';
import {
  addAttemptUsage,
  attemptsForOutcome,
  emptyUsage,
} from './task-usage.js';
import type {
  AcceptedTaskResult,
  CumulativeTaskUsage,
  Logger,
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  TaskOutcome,
  WaitForTaskOptions,
} from './types.js';
import { taskCreateIdempotencyKey } from './types.js';

export type FrozenTaskRequest = Parameters<TaskClient['createTask']>[0];

/** A single action selected by the orchestrator, with no task contents. */
export interface RecoveryCandidate {
  action: 'replace_stage_task';
  failedTaskId: string;
  originalTaskId: string;
  inputCid: string;
  correlationId: string | null;
  parentTaskId: string | null;
  replacementN: number;
  remainingReplacements: number;
}

export interface RecoveryFailureSummary {
  /** Application-sanitized classification; never include task output or secrets. */
  code: string;
  /** Optional application-sanitized detail, capped by the core. */
  detail?: string;
}

export interface RecoveryGateInput {
  candidate: Readonly<RecoveryCandidate>;
  failure: Readonly<RecoveryFailureSummary>;
  decisionInputDigest: string;
  /** Stable key to forward to an external decision service. */
  idempotencyKey?: string;
  signal: AbortSignal;
}

export interface RecoveryGateDecision {
  verdict: 'approve' | 'deny' | 'abstain';
  reasonCode: string;
  confidence?: number;
  engine?: { name: string; version: string };
}

export interface RecoveryGate {
  identity: { name: string; version: string };
  decide(input: RecoveryGateInput): Promise<RecoveryGateDecision>;
}

export interface RecoveryDecisionRecord {
  gateIdentity: { name: string; version: string };
  candidate: RecoveryCandidate;
  decisionInputDigest: string;
  verdict: RecoveryGateDecision['verdict'] | 'invalid';
  reasonCode: string;
  confidence?: number;
  engine?: RecoveryGateDecision['engine'];
  replacementTaskId?: string;
}

export interface RecoveryChainElement<TState> {
  replacementN: number;
  outcome: TaskOutcome<TState>;
  /** Every execution attempt for this task, including those before acceptance. */
  attempts: SdkTaskAttempt[];
}

export interface WaitForRecoverableTaskOptions<
  TState,
> extends WaitForTaskOptions<TState> {
  /** Exact request used for this stage, including a failed semantic repair. */
  frozenRequest: FrozenTaskRequest;
  maxReplacements: number;
  recoveryGate: RecoveryGate;
  gateTimeoutMs: number;
  /** The callback receives full evidence; its returned summary goes to the gate. */
  summarizeFailure?: (input: {
    task: SdkTask;
    attempts: SdkTaskAttempt[];
  }) => RecoveryFailureSummary;
  /** Cancellation is ordinarily an operator decision, not an execution failure. */
  recoverCancelled?: boolean;
  /** Stable prefix unique to this stage within the workflow execution. */
  checkpointPrefix: string;
  /** For continuation tasks, the last completed source task. */
  parentTaskId?: string | null;
}

type RecoveryBase<TState> = {
  chain: RecoveryChainElement<TState>[];
  decisions: RecoveryDecisionRecord[];
  cumulativeUsage: CumulativeTaskUsage;
};

export type RecoverableTaskOutcome<TState> = RecoveryBase<TState> &
  (
    | { kind: 'accepted'; result: AcceptedTaskResult<TState> }
    | {
        kind: 'invalid_output';
        outcome: Extract<TaskOutcome<TState>, { kind: 'invalid_output' }>;
      }
    | {
        kind: 'failed';
        outcome: Extract<TaskOutcome<TState>, { kind: 'failed' }>;
        reasonCode: 'budget_exhausted' | 'cancelled' | 'not_terminal';
      }
    | {
        kind: 'blocked';
        outcome: Extract<TaskOutcome<TState>, { kind: 'failed' }>;
        decision: RecoveryDecisionRecord;
      }
    | {
        kind: 'replacement_create_failed';
        outcome: Extract<TaskOutcome<TState>, { kind: 'failed' }>;
        reasonCode: string;
      }
  );

function matchesFrozenRequest(task: SdkTask, body: FrozenTaskRequest): boolean {
  const tags = [...new Set((body.tags ?? []).map((tag) => tag.trim()))].filter(
    Boolean,
  );
  return (
    task.taskType === body.taskType &&
    task.title === (body.title?.trim() || null) &&
    isDeepStrictEqual(task.tags, tags) &&
    task.teamId === body.teamId &&
    task.diaryId === body.diaryId &&
    task.projectId === (body.projectId ?? null) &&
    task.correlationId === (body.correlationId ?? null) &&
    task.maxAttempts === (body.maxAttempts ?? 1) &&
    task.dispatchTimeoutSec === (body.dispatchTimeoutSec ?? null) &&
    task.runningTimeoutSec === (body.runningTimeoutSec ?? null) &&
    isDeepStrictEqual(task.input, body.input) &&
    isDeepStrictEqual(task.references, body.references ?? []) &&
    isDeepStrictEqual(task.claimCondition, body.claimCondition ?? null) &&
    isDeepStrictEqual(task.allowedProfiles, body.allowedProfiles ?? []) &&
    task.requiredExecutorTrustLevel ===
      (body.requiredExecutorTrustLevel ?? 'selfDeclared')
  );
}

function continuationParent(input: unknown): string | null {
  if (!input || typeof input !== 'object' || !('continueFrom' in input))
    return null;
  const continuation = input.continueFrom;
  if (
    !continuation ||
    typeof continuation !== 'object' ||
    !('taskId' in continuation)
  )
    return null;
  return typeof continuation.taskId === 'string' ? continuation.taskId : null;
}

function validatedSummary(
  summary: RecoveryFailureSummary,
): RecoveryFailureSummary {
  if (
    !summary ||
    typeof summary.code !== 'string' ||
    !/^[a-zA-Z0-9_.:-]{1,80}$/.test(summary.code) ||
    (summary.detail !== undefined &&
      (typeof summary.detail !== 'string' || summary.detail.length > 2_000))
  ) {
    throw new TypeError('invalid sanitized recovery failure summary');
  }
  return {
    code: summary.code,
    ...(summary.detail === undefined ? {} : { detail: summary.detail }),
  };
}

function validDecision(value: unknown): value is RecoveryGateDecision {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Partial<RecoveryGateDecision>;
  return (
    (decision.verdict === 'approve' ||
      decision.verdict === 'deny' ||
      decision.verdict === 'abstain') &&
    typeof decision.reasonCode === 'string' &&
    /^[a-zA-Z0-9_.:-]{1,80}$/.test(decision.reasonCode) &&
    (decision.confidence === undefined ||
      (typeof decision.confidence === 'number' &&
        Number.isFinite(decision.confidence) &&
        decision.confidence >= 0 &&
        decision.confidence <= 1)) &&
    (decision.engine === undefined ||
      (typeof decision.engine?.name === 'string' &&
        decision.engine.name.length > 0 &&
        decision.engine.name.length <= 80 &&
        typeof decision.engine.version === 'string' &&
        decision.engine.version.length > 0 &&
        decision.engine.version.length <= 80))
  );
}

async function decideWithTimeout(
  gate: RecoveryGate,
  input: Omit<RecoveryGateInput, 'signal'>,
  timeoutMs: number,
  logger?: Logger,
  logPrefix = 'orchestration',
): Promise<RecoveryGateDecision | { verdict: 'invalid'; reasonCode: string }> {
  const controller = new AbortController();
  const timeoutError = new Error('recovery gate timed out');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      gate.decide({ ...input, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError), timeoutMs);
      }),
    ]);
    if (!validDecision(result))
      return { verdict: 'invalid', reasonCode: 'gate_invalid' };
    return {
      verdict: result.verdict,
      reasonCode: result.reasonCode,
      ...(result.confidence === undefined
        ? {}
        : { confidence: result.confidence }),
      ...(result.engine === undefined
        ? {}
        : {
            engine: {
              name: result.engine.name,
              version: result.engine.version,
            },
          }),
    };
  } catch (error) {
    if (isWorkflowInterruption(error)) throw error;
    logger?.error(
      {
        err: error,
        gateIdentity: gate.identity,
        failedTaskId: input.candidate.failedTaskId,
        replacementN: input.candidate.replacementN,
      },
      `${logPrefix}.recovery.gate.error`,
    );
    return {
      verdict: 'invalid',
      reasonCode: error === timeoutError ? 'gate_timeout' : 'gate_error',
    };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

/** Replace a terminally failed stage under a separate durable decision and create checkpoint. */
export async function waitForRecoverableTask<TState>(
  initialTask: SdkTask,
  options: WaitForRecoverableTaskOptions<TState>,
): Promise<RecoverableTaskOutcome<TState>> {
  if (
    !Number.isSafeInteger(options.maxReplacements) ||
    options.maxReplacements < 0
  )
    throw new RangeError('maxReplacements must be a non-negative safe integer');
  if (
    !Number.isSafeInteger(options.gateTimeoutMs) ||
    options.gateTimeoutMs <= 0
  )
    throw new RangeError('gateTimeoutMs must be a positive safe integer');
  if (!options.checkpointPrefix || options.checkpointPrefix.length > 200)
    throw new RangeError(
      'checkpointPrefix must be non-empty and at most 200 characters',
    );
  const gateIdentity = options.recoveryGate.identity;
  if (
    !gateIdentity ||
    typeof gateIdentity.name !== 'string' ||
    gateIdentity.name.length === 0 ||
    gateIdentity.name.length > 80 ||
    typeof gateIdentity.version !== 'string' ||
    gateIdentity.version.length === 0 ||
    gateIdentity.version.length > 80
  )
    throw new TypeError('recoveryGate identity requires a name and version');
  const frozenRequest = structuredClone(options.frozenRequest);
  if (!matchesFrozenRequest(initialTask, frozenRequest))
    throw new TypeError('frozenRequest does not match the initial task');
  const frozenParent = continuationParent(frozenRequest.input);
  const stableGateIdentity = Object.freeze({
    name: gateIdentity.name,
    version: gateIdentity.version,
  });
  const checkpointPrefix = options.checkpointPrefix;
  const maxReplacements = options.maxReplacements;
  const recoverCancelled = options.recoverCancelled === true;
  if (
    frozenParent &&
    options.parentTaskId !== undefined &&
    options.parentTaskId !== frozenParent
  )
    throw new TypeError(
      'parentTaskId does not match the frozen continuation source',
    );

  const chain: RecoveryChainElement<TState>[] = [];
  const decisions: RecoveryDecisionRecord[] = [];
  const cumulativeUsage: CumulativeTaskUsage = emptyUsage();
  let currentTask = initialTask;
  let replacementN = 0;

  for (;;) {
    const outcome = await waitForTaskOutcome(currentTask.id, options);
    const attempts = await attemptsForOutcome(outcome, options.tasks);
    chain.push({ replacementN, outcome, attempts });
    addAttemptUsage(cumulativeUsage, attempts);
    const base = { chain, decisions, cumulativeUsage };
    if (outcome.kind === 'accepted')
      return { ...base, kind: 'accepted', result: outcome.result };
    if (outcome.kind === 'invalid_output')
      return { ...base, kind: 'invalid_output', outcome };
    if (outcome.task.status !== 'failed' && outcome.task.status !== 'cancelled')
      return { ...base, kind: 'failed', outcome, reasonCode: 'not_terminal' };
    if (outcome.task.status === 'cancelled' && !recoverCancelled)
      return { ...base, kind: 'failed', outcome, reasonCode: 'cancelled' };
    if (replacementN >= maxReplacements)
      return {
        ...base,
        kind: 'failed',
        outcome,
        reasonCode: 'budget_exhausted',
      };

    const candidate: RecoveryCandidate = Object.freeze({
      action: 'replace_stage_task',
      failedTaskId: outcome.task.id,
      originalTaskId: initialTask.id,
      inputCid: initialTask.inputCid,
      correlationId: initialTask.correlationId,
      parentTaskId: frozenParent ?? options.parentTaskId ?? null,
      replacementN: replacementN + 1,
      remainingReplacements: maxReplacements - replacementN - 1,
    });
    const decisionName = `${checkpointPrefix}.recovery.${candidate.replacementN}.decision`;
    const failure = Object.freeze(
      validatedSummary(
        options.summarizeFailure?.({
          task: outcome.task,
          attempts: outcome.attempts,
        }) ?? { code: `task_${outcome.task.status}` },
      ),
    );
    const decisionInputDigest = createHash('sha256')
      .update(JSON.stringify({ candidate, failure }))
      .digest('hex');
    const decision = await options.ctx.step(decisionName, async () => {
      const verdict = await decideWithTimeout(
        options.recoveryGate,
        {
          candidate,
          failure,
          decisionInputDigest,
          idempotencyKey: taskCreateIdempotencyKey(options.ctx, decisionName),
        },
        options.gateTimeoutMs,
        options.logger,
        options.logPrefix,
      );
      return {
        candidate,
        gateIdentity: {
          name: stableGateIdentity.name,
          version: stableGateIdentity.version,
        },
        decisionInputDigest,
        ...verdict,
      } satisfies RecoveryDecisionRecord;
    });
    if (
      !isDeepStrictEqual(decision.candidate, candidate) ||
      decision.decisionInputDigest !== decisionInputDigest ||
      !isDeepStrictEqual(decision.gateIdentity, stableGateIdentity)
    )
      throw new Error(
        'replayed recovery decision does not match the current candidate or gate identity',
      );
    decisions.push(decision);
    if (decision.verdict !== 'approve')
      return { ...base, kind: 'blocked', outcome, decision };

    try {
      const replacement = await createTaskStep(
        options.ctx,
        `${checkpointPrefix}.recovery.${candidate.replacementN}.create`,
        ({ idempotencyKey }) =>
          options.tasks.createTask(frozenRequest, { idempotencyKey }),
      );
      if (
        replacement.id === currentTask.id ||
        replacement.maxAttempts !== initialTask.maxAttempts ||
        !matchesFrozenRequest(replacement, frozenRequest) ||
        replacement.inputCid !== initialTask.inputCid
      )
        return {
          ...base,
          kind: 'replacement_create_failed',
          outcome,
          reasonCode: 'replacement_identity_mismatch',
        };
      decisions[decisions.length - 1] = {
        ...decision,
        replacementTaskId: replacement.id,
      };
      currentTask = replacement;
      replacementN += 1;
    } catch (error) {
      if (isWorkflowInterruption(error)) throw error;
      options.logger?.error(
        {
          err: error,
          failedTaskId: currentTask.id,
          replacementN: candidate.replacementN,
        },
        `${options.logPrefix ?? 'orchestration'}.recovery.create.error`,
      );
      return {
        ...base,
        kind: 'replacement_create_failed',
        outcome,
        reasonCode: 'replacement_create_error',
      };
    }
  }
}
