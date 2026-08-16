import { createHash } from 'node:crypto';

import type { Agent, CreateTaskBody } from '@themoltnet/sdk';

/**
 * Task and task-attempt shapes as returned by the MoltNet SDK. Derived from the
 * SDK client so the orchestration lib never restates the wire types.
 */
export type SdkTask = Awaited<ReturnType<Agent['tasks']['get']>>;
export type SdkTaskAttempt = Awaited<
  ReturnType<Agent['tasks']['listAttempts']>
>[number];

/**
 * Minimal logger surface; a Pino logger or `console` both satisfy it. `debug`
 * is optional: the await engine routes high-frequency per-poll records to it so
 * a long fan-out doesn't flood `info`; loggers without `debug` simply drop them.
 */
export type Logger = Pick<Console, 'info' | 'warn' | 'error'> & {
  debug?: Console['debug'];
};

export interface TaskMessage {
  seq: number;
  kind: string;
  payload: unknown;
  timestamp?: string;
}

/**
 * Transport-neutral durable-execution seam. A workflow is written against this
 * interface so the SAME code runs synchronously in tests (see `inlineContext`)
 * or durably on Absurd (see `asWorkflowContext`).
 *
 * - `step` wraps a durable, replay-cached side-effect boundary. Keep each
 *   external mutation in its own step so replay cannot duplicate a partial batch.
 * - `sleepFor` is the timeout fallback for waits.
 * - `awaitEvent`/`emitEvent` are optional: present on durable backends that can
 *   suspend on an event, absent inline (callers fall back to `sleepFor`).
 */
export interface WorkflowContext {
  /** Stable Absurd execution identity used to derive external idempotency keys. */
  executionId: string;
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  beginStep<T>(name: string): Promise<WorkflowStepHandle<T>>;
  completeStep<T>(handle: WorkflowStepHandle<T>, value: T): Promise<T>;
  sleepFor(name: string, seconds: number): Promise<void>;
  awaitEvent?(
    eventName: string,
    options?: { stepName?: string; timeout?: number },
  ): Promise<unknown>;
  emitEvent?(eventName: string, payload?: unknown): Promise<void>;
}

export type WorkflowStepHandle<T> = {
  readonly name: string;
  readonly checkpointName: string;
} & (
  | { readonly done: false; readonly state?: never }
  | { readonly done: true; readonly state: T }
);

/**
 * Minimal task I/O client the engine needs. `teamId` rides alongside the create
 * body and is split into the SDK's team-context option by the implementation
 * (see `createSdkTaskClient`).
 */
export interface TaskClient {
  createTask(
    body: CreateTaskBody & { teamId: string },
    options?: { idempotencyKey?: string },
  ): Promise<SdkTask>;
  getTask(id: string): Promise<SdkTask>;
  listAttempts(id: string): Promise<SdkTaskAttempt[]>;
  listMessages?(id: string, attemptN: number): Promise<TaskMessage[]>;
}

/** Stable retry key for a semantic child-task create checkpoint. */
export function taskCreateIdempotencyKey(
  ctx: Pick<WorkflowContext, 'executionId'>,
  createStepName: string,
): string {
  const digest = createHash('sha256')
    .update(`${ctx.executionId}\0${createStepName}`)
    .digest('base64url');
  return `absurd:${digest}`;
}

/** An accepted task attempt plus its parsed, domain-specific state artifact. */
export interface AcceptedTaskResult<TState = unknown> {
  task: SdkTask;
  attempt: SdkTaskAttempt;
  state: TState;
}

/** The three terminal outcomes of awaiting a task. */
export type TaskOutcome<TState = unknown> =
  | { kind: 'accepted'; result: AcceptedTaskResult<TState> }
  | {
      kind: 'failed';
      task: SdkTask;
      attempts: SdkTaskAttempt[];
      reason: string;
    }
  | {
      kind: 'invalid_output';
      task: SdkTask;
      attempt: SdkTaskAttempt;
      reason: string;
    };
