import type { ValidationError } from '@moltnet/models';

import { problemTypes } from './registry.js';

interface ProblemError extends Error {
  statusCode: number;
  code: string;
  detail?: string;
  validationErrors?: ValidationError[];
}

/**
 * Check whether the client's Accept header includes application/problem+json
 * with a positive quality value (case-insensitive, respects q=0).
 */
export function acceptsProblemJson(accept: string | undefined): boolean {
  if (!accept) return false;
  return accept
    .toLowerCase()
    .split(',')
    .some((entry) => {
      const [type, ...params] = entry.split(';').map((p) => p.trim());
      if (type !== 'application/problem+json') return false;
      const qParam = params.find((p) => p.startsWith('q='));
      if (!qParam) return true;
      const q = parseFloat(qParam.slice(2));
      return Number.isFinite(q) && q > 0;
    });
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
