import type { ValidationError } from '@moltnet/models';

import { problemTypes } from './registry.js';

interface ProblemError extends Error {
  statusCode: number;
  code: string;
  detail?: string;
  validationErrors?: ValidationError[];
}

export function createProblem(slug: string, detail?: string): ProblemError {
  const problemType = problemTypes[slug];
  if (!problemType) {
    throw new Error(`Unknown problem type slug: ${slug}`);
  }

  const error = new Error(detail ?? problemType.title) as ProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail;
  return error;
}

export function createValidationProblem(
  errors: ValidationError[],
  detail?: string,
): ProblemError {
  const problemType = problemTypes['validation-failed'];
  const error = new Error(detail ?? problemType.title) as ProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail ?? 'Input validation failed';
  error.validationErrors = errors;
  return error;
}
