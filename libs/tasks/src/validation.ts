import './formats.js';

import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { BUILT_IN_TASK_TYPES } from './task-types/index.js';
import type { TaskRef } from './wire.js';

export interface TaskValidationError {
  field: string;
  message: string;
}

interface TaskTypeDefinition {
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly requiresReferences: boolean;
  readonly validateInput?: (input: unknown) => string | null;
  readonly validateOutput?: (output: unknown) => string | null;
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
    const validationError = entry.validateOutput(output);
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
