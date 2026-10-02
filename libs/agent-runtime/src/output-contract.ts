import {
  FREEFORM_TYPE,
  FreeformSubmission,
  getOutputContract,
  getTaskSubmissionSchema,
  outputContractResultSchema,
  type TaskValidationError,
  validateOutputContract,
  validateOutputContractResult,
  validateTaskOutput,
  validateTaskSubmission,
} from '@moltnet/tasks';
import { type TSchema, Type } from 'typebox';

/** The server stores this value; the daemon resolves it before execution. */
export function validateAgentOutputContract(
  taskType: string,
  input: unknown,
): TaskValidationError[] {
  return validateOutputContract(taskType, input);
}

/** One schema for submit tool advertisement and daemon submission validation. */
export function getAgentSubmissionSchema(
  taskType: string,
  input?: unknown,
): TSchema | null {
  const base = getTaskSubmissionSchema(taskType);
  if (!base) return null;
  if (taskType !== FREEFORM_TYPE || getOutputContract(input) === undefined) {
    return base;
  }
  const result = outputContractResultSchema(input);
  if (!result) return null;
  return Type.Object(
    { ...FreeformSubmission.properties, result },
    { additionalProperties: false },
  );
}

export function validateAgentTaskSubmission(
  taskType: string,
  submission: unknown,
  input?: unknown,
  runtime?: { inputCid?: string },
): TaskValidationError[] {
  const contracted =
    taskType === FREEFORM_TYPE && getOutputContract(input) !== undefined;
  const standard = contracted
    ? validateTaskOutput(taskType, submission, input, runtime)
    : validateTaskSubmission(taskType, submission, input, runtime);
  return [
    ...standard,
    ...validateOutputContractResult(taskType, input, submission),
  ];
}

export function validateAgentTaskOutput(
  taskType: string,
  output: unknown,
  input?: unknown,
  runtime?: { inputCid?: string },
): TaskValidationError[] {
  return [
    ...validateTaskOutput(taskType, output, input, runtime),
    ...validateOutputContractResult(taskType, input, output),
  ];
}
