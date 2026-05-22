import './formats.js';

import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  type AsyncTaskValidationContext,
  type TaskCreateSideEffect,
  type TaskValidationError,
} from './async-validation.js';
import type { Gate } from './success-criteria.js';
import { BUILT_IN_TASK_TYPES } from './task-types/index.js';
import type { TaskRef } from './wire.js';

export type { TaskValidationError } from './async-validation.js';

interface TaskTypeDefinition {
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly resumable?: boolean;
  readonly workspaceMode?: 'shared_mount' | 'dedicated_worktree';
  readonly workspaceScope?: 'attempt' | 'session';
  readonly sessionScope?: 'none' | 'correlation' | 'custom';
  readonly requiresReferences: boolean;
  readonly validateInput?: (input: unknown) => string | null;
  readonly validateOutput?: (output: unknown, input?: unknown) => string | null;
  readonly usesSubagents?: boolean;
  readonly validateInputAsync?: (
    input: unknown,
    ctx: AsyncTaskValidationContext,
  ) => Promise<TaskValidationError[]>;
  readonly onCreate?: (
    input: unknown,
    ctx: AsyncTaskValidationContext,
  ) => Promise<TaskCreateSideEffect[]>;
}

const PRODUCER_TASK_TYPES_WITH_SUBMIT_GATE = new Set([
  'fulfill_brief',
  'curate_pack',
  'render_pack',
  'run_eval',
]);

export const SUBMIT_OUTPUT_GATE_ID = 'submit-output';

function getSubmitOutputGate(taskType: string): Gate {
  return {
    id: SUBMIT_OUTPUT_GATE_ID,
    kind: 'submit-tool-call',
    description:
      `Call \`submit_${taskType}_output\` exactly once with valid ` +
      'structured output.',
    required: true,
  };
}

function getTaskTypeEntry(taskType: string) {
  const taskTypes = BUILT_IN_TASK_TYPES as Record<
    string,
    TaskTypeDefinition | undefined
  >;

  if (!Object.prototype.hasOwnProperty.call(taskTypes, taskType)) {
    return undefined;
  }

  return taskTypes[taskType];
}

function formatField(prefix: string, path: string): string {
  return path ? `${prefix}${path}` : prefix;
}

export function normalizeTaskInputForCreate(
  taskType: string,
  input: unknown,
): unknown {
  if (!PRODUCER_TASK_TYPES_WITH_SUBMIT_GATE.has(taskType)) {
    return input;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return input;
  }

  const taskInput = input as Record<string, unknown>;
  const rawCriteria =
    typeof taskInput.successCriteria === 'object' &&
    taskInput.successCriteria !== null &&
    !Array.isArray(taskInput.successCriteria)
      ? (taskInput.successCriteria as Record<string, unknown>)
      : null;
  const gates = Array.isArray(rawCriteria?.gates)
    ? [...(rawCriteria.gates as Gate[])]
    : [];

  if (
    !gates.some(
      (gate) =>
        typeof gate === 'object' &&
        gate !== null &&
        'id' in gate &&
        gate.id === SUBMIT_OUTPUT_GATE_ID,
    )
  ) {
    gates.push(getSubmitOutputGate(taskType));
  }

  return {
    ...taskInput,
    successCriteria: {
      version: 1,
      ...(rawCriteria ?? {}),
      gates,
    },
  };
}

function schemaErrors(
  prefix: string,
  schema: Parameters<typeof Value.Errors>[0],
  value: unknown,
): TaskValidationError[] {
  return [...Value.Errors(schema, value)].map((error) => ({
    field: formatField(prefix, error.path),
    message: error.message,
  }));
}

export function validateTaskInput(
  taskType: string,
  input: unknown,
): TaskValidationError[] {
  const entry = getTaskTypeEntry(taskType);
  if (!entry) {
    return [
      {
        field: 'taskType',
        message: `Unknown task type: ${taskType}`,
      },
    ];
  }

  const errors = schemaErrors('input', entry.inputSchema, input);
  if (errors.length > 0) return errors;

  if (entry.validateInput) {
    const validationError = entry.validateInput(input);
    if (validationError) {
      return [{ field: 'input', message: validationError }];
    }
  }

  return [];
}

export function validateTaskOutput(
  taskType: string,
  output: unknown,
  /**
   * The task input. Optional for backward-compat with callers that have
   * no input on hand (e.g. ad-hoc tooling), but required for the
   * cross-field rules enforced by some `validateOutput` hooks (e.g.
   * "verification is required when input.successCriteria is set" on
   * fulfillment task types). When omitted, those cross-field checks are
   * skipped — the server passes input from the row, so missing it is a
   * caller bug, not a normal flow.
   */
  input?: unknown,
): TaskValidationError[] {
  const entry = getTaskTypeEntry(taskType);
  if (!entry) {
    return [
      {
        field: 'taskType',
        message: `Unknown task type: ${taskType}`,
      },
    ];
  }

  const errors = schemaErrors('output', entry.outputSchema, output);
  if (errors.length > 0) return errors;

  if (entry.validateOutput) {
    const validationError = entry.validateOutput(output, input);
    if (validationError) {
      return [{ field: 'output', message: validationError }];
    }
  }

  return [];
}

/**
 * Resolve the TypeBox output schema registered for `taskType`. Returns
 * `null` for unknown task types — callers (e.g. submit-tool factories)
 * decide how to surface that.
 */
export function getTaskOutputSchema(taskType: string): TSchema | null {
  return getTaskTypeEntry(taskType)?.outputSchema ?? null;
}

/**
 * Whether sessions running this task type should have the generic
 * `subagent` custom tool registered. Returns `false` for unknown task
 * types and for task types that didn't opt in. See `TaskTypeEntry`
 * for the design rationale.
 */
export function taskTypeUsesSubagents(taskType: string): boolean {
  return getTaskTypeEntry(taskType)?.usesSubagents === true;
}

/**
 * Filesystem isolation policy requested by the task type.
 *
 * Unknown task types and task types without an explicit policy default to the
 * legacy/shared behaviour.
 */
export function taskTypeWorkspaceMode(
  taskType: string,
): 'shared_mount' | 'dedicated_worktree' {
  return getTaskTypeEntry(taskType)?.workspaceMode ?? 'shared_mount';
}

/**
 * Whether the daemon may keep a warm executor session alive after one
 * attempt completes and reuse it for later related tasks.
 *
 * Unknown task types default to `false`.
 */
export function taskTypeResumable(taskType: string): boolean {
  return getTaskTypeEntry(taskType)?.resumable === true;
}

/**
 * Lifetime of the task type's workspace.
 *
 * Unknown task types and task types without an explicit policy default to the
 * disposable per-attempt behavior.
 */
export function taskTypeWorkspaceScope(
  taskType: string,
): 'attempt' | 'session' {
  return getTaskTypeEntry(taskType)?.workspaceScope ?? 'attempt';
}

/**
 * Granularity of daemon-local warm-session reuse.
 *
 * Unknown task types and task types without an explicit policy default to no
 * reuse.
 */
export function taskTypeSessionScope(
  taskType: string,
): 'none' | 'correlation' | 'custom' {
  return getTaskTypeEntry(taskType)?.sessionScope ?? 'none';
}

export interface TaskExecutionPolicy {
  resumable: boolean;
  workspaceMode: 'shared_mount' | 'dedicated_worktree';
  workspaceScope: 'attempt' | 'session';
  sessionScope: 'none' | 'correlation' | 'custom';
  usesSubagents: boolean;
}

/**
 * Resolve the daemon-relevant execution policy declared by a task type.
 *
 * This is the single read path for "may this task reuse a warm session?" and
 * "does its workspace belong to the attempt or the session?" so daemon code
 * doesn't need to hand-roll defaults or peek at the raw registry shape.
 */
export function getTaskExecutionPolicy(taskType: string): TaskExecutionPolicy {
  return {
    resumable: taskTypeResumable(taskType),
    workspaceMode: taskTypeWorkspaceMode(taskType),
    workspaceScope: taskTypeWorkspaceScope(taskType),
    sessionScope: taskTypeSessionScope(taskType),
    usesSubagents: taskTypeUsesSubagents(taskType),
  };
}

export function validateTaskCreateRequest(args: {
  taskType: string;
  input: unknown;
  references?: TaskRef[] | null;
}): TaskValidationError[] {
  const entry = getTaskTypeEntry(args.taskType);
  if (!entry) {
    return [
      {
        field: 'taskType',
        message: `Unknown task type: ${args.taskType}`,
      },
    ];
  }

  const inputErrors = validateTaskInput(args.taskType, args.input);
  if (inputErrors.length > 0) return inputErrors;

  const errors: TaskValidationError[] = [];
  if (
    entry.requiresReferences &&
    (!args.references || args.references.length < 1)
  ) {
    errors.push({
      field: 'references',
      message: `At least one reference is required for task type: ${args.taskType}`,
    });
  }
  return errors;
}

/**
 * Run a task type's async preflight validator (#1096) if registered.
 * Returns an empty array when the task type has no async validator
 * OR when its validator returned no errors. Callers MUST run this
 * AFTER `validateTaskCreateRequest` returned no errors — async
 * validators rely on the synchronous invariants holding.
 */
export async function validateTaskInputAsync(
  taskType: string,
  input: unknown,
  ctx: AsyncTaskValidationContext,
): Promise<TaskValidationError[]> {
  const entry = getTaskTypeEntry(taskType);
  if (!entry?.validateInputAsync) return [];
  return entry.validateInputAsync(input, ctx);
}

/**
 * Compute a task type's create-time side effects (#1096) if it
 * declared any. Returns an empty array when no `onCreate` hook is
 * registered. Callers (the task service) apply the returned effects
 * inside the same transaction as the task insert.
 */
export async function getTaskCreateSideEffects(
  taskType: string,
  input: unknown,
  ctx: AsyncTaskValidationContext,
): Promise<TaskCreateSideEffect[]> {
  const entry = getTaskTypeEntry(taskType);
  if (!entry?.onCreate) return [];
  return entry.onCreate(input, ctx);
}
