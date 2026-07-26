import type { ProblemCode, ValidationError } from '@moltnet/models';

interface ProblemType {
  code: ProblemCode;
  status: number;
  title: string;
}

const problemTypes = {
  conflict: {
    code: 'CONFLICT',
    status: 409,
    title: 'Conflict',
  },
  forbidden: {
    code: 'FORBIDDEN',
    status: 403,
    title: 'Forbidden',
  },
  'not-found': {
    code: 'NOT_FOUND',
    status: 404,
    title: 'Not Found',
  },
  'upstream-error': {
    code: 'UPSTREAM_ERROR',
    status: 502,
    title: 'Upstream Error',
  },
  'validation-failed': {
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'Validation Failed',
  },
} as const satisfies Record<string, ProblemType>;

export interface RuntimePolicyProblemError extends Error {
  statusCode: number;
  code: ProblemCode;
  detail?: string;
  validationErrors?: ValidationError[];
}

export function createProblem(
  slug: keyof typeof problemTypes,
  detail?: string,
): RuntimePolicyProblemError {
  const problemType = problemTypes[slug];
  const error = new Error(
    detail ?? problemType.title,
  ) as RuntimePolicyProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail;
  return error;
}

export function createValidationProblem(
  errors: ValidationError[],
  detail?: string,
): RuntimePolicyProblemError {
  const problemType = problemTypes['validation-failed'];
  const error = new Error(
    detail ?? problemType.title,
  ) as RuntimePolicyProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail ?? 'Input validation failed';
  error.validationErrors = errors;
  return error;
}
