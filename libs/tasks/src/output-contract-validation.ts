import { Value } from 'typebox/value';

import type { TaskValidationError } from './async-validation.js';
import {
  outputContractResultSchema,
  validateOutputContractSchema,
} from './output-contract-schema.js';
import { FREEFORM_TYPE } from './task-types/freeform.js';

/**
 * Proposer-supplied `freeform` output contracts. The server stores them
 * verbatim and never interprets them; executors and readers enforce them with
 * the functions below so every consumer applies the same rules.
 */
export function getOutputContract(input: unknown): unknown {
  return input && typeof input === 'object' && 'outputContract' in input
    ? input.outputContract
    : undefined;
}

/** Validate the contract itself: version and supported JSON Schema subset. */
export function validateOutputContract(
  taskType: string,
  input: unknown,
): TaskValidationError[] {
  if (taskType !== FREEFORM_TYPE) return [];
  const contract = getOutputContract(input);
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

/**
 * Validate `output.result` against the task's `input.outputContract`. A
 * contracted task must carry a conforming `result`; an uncontracted one must
 * not carry `result` at all. Non-freeform task types have no contract.
 */
export function validateOutputContractResult(
  taskType: string,
  input: unknown,
  output: unknown,
): TaskValidationError[] {
  if (taskType !== FREEFORM_TYPE) return [];
  const contract = getOutputContract(input);
  if (contract === undefined) {
    return output && typeof output === 'object' && 'result' in output
      ? [{ field: 'output/result', message: 'requires input.outputContract' }]
      : [];
  }
  const schema = outputContractResultSchema(input);
  if (!schema) return validateOutputContract(taskType, input);
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
