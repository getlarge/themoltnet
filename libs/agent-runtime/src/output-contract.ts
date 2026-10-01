import {
  FREEFORM_TYPE,
  FreeformSubmission,
  getTaskSubmissionSchema,
  type TaskValidationError,
  validateTaskOutput,
  validateTaskSubmission,
} from '@moltnet/tasks';
import { type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';

import {
  outputContractResultSchema,
  validateOutputContractSchema,
} from './output-contract-schema.js';

function contractFrom(input: unknown): unknown {
  return input && typeof input === 'object' && 'outputContract' in input
    ? input.outputContract
    : undefined;
}

/** The server stores this value; the daemon resolves it before execution. */
export function validateAgentOutputContract(
  taskType: string,
  input: unknown,
): TaskValidationError[] {
  if (taskType !== FREEFORM_TYPE) return [];
  const contract = contractFrom(input);
  if (contract === undefined) return [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return [{ field: 'input/outputContract', message: 'must be an object' }];
  }
  const value = contract as Record<string, unknown>;
  if (value.version !== 1) {
    return [{ field: 'input/outputContract/version', message: 'must be 1' }];
  }
  const error = validateOutputContractSchema(value.schema);
  return error
    ? [{ field: 'input/outputContract/schema', message: error }]
    : [];
}

/** One schema for Pi tool advertisement and daemon submission validation. */
export function getAgentSubmissionSchema(
  taskType: string,
  input?: unknown,
): TSchema | null {
  const base = getTaskSubmissionSchema(taskType);
  if (!base) return null;
  if (taskType !== FREEFORM_TYPE || contractFrom(input) === undefined) {
    return base;
  }
  const result = outputContractResultSchema(input);
  if (!result) return null;
  return Type.Object(
    { ...FreeformSubmission.properties, result },
    { additionalProperties: false },
  );
}

function resultErrors(input: unknown, output: unknown): TaskValidationError[] {
  const contract = contractFrom(input);
  if (contract === undefined) {
    return output && typeof output === 'object' && 'result' in output
      ? [{ field: 'output/result', message: 'requires input.outputContract' }]
      : [];
  }
  const schema = outputContractResultSchema(input);
  if (!schema) return validateAgentOutputContract(FREEFORM_TYPE, input);
  if (!output || typeof output !== 'object' || !('result' in output)) {
    return [{ field: 'output/result', message: 'is required' }];
  }
  return [
    ...Value.Errors(schema, (output as { result: unknown }).result),
  ].flatMap((rawError) => {
    const error = rawError as typeof rawError & {
      keyword?: string;
      params?: {
        requiredProperties?: string[];
        additionalProperties?: string[];
      };
    };
    const field = `output/result${error.instancePath}`;
    if (error.keyword === 'required' && error.params?.requiredProperties) {
      return error.params.requiredProperties.map((property) => ({
        field: `${field}/${property}`,
        message: `must have required property ${property}`,
      }));
    }
    if (
      error.keyword === 'additionalProperties' &&
      error.params?.additionalProperties
    ) {
      return error.params.additionalProperties.map((property) => ({
        field: `${field}/${property}`,
        message: error.message,
      }));
    }
    return [{ field, message: error.message }];
  });
}

export function validateAgentTaskSubmission(
  taskType: string,
  submission: unknown,
  input?: unknown,
  runtime?: { inputCid?: string },
): TaskValidationError[] {
  const contracted =
    taskType === FREEFORM_TYPE && contractFrom(input) !== undefined;
  const standard = contracted
    ? validateTaskOutput(taskType, submission, input, runtime)
    : validateTaskSubmission(taskType, submission, input, runtime);
  return taskType === FREEFORM_TYPE
    ? [...standard, ...resultErrors(input, submission)]
    : standard;
}

export function validateAgentTaskOutput(
  taskType: string,
  output: unknown,
  input?: unknown,
  runtime?: { inputCid?: string },
): TaskValidationError[] {
  const standard = validateTaskOutput(taskType, output, input, runtime);
  return taskType === FREEFORM_TYPE
    ? [...standard, ...resultErrors(input, output)]
    : standard;
}
