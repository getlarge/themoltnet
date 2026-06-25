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
  'service-unavailable': {
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
    title: 'Service Unavailable',
  },
  'validation-failed': {
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'Validation Failed',
  },
} as const satisfies Record<string, ProblemType>;

export interface RuntimeSessionProblemError extends Error {
  statusCode: number;
  code: ProblemCode;
  detail?: string;
  validationErrors?: ValidationError[];
  extensions?: Record<string, unknown>;
}

export function createProblem(
  slug: keyof typeof problemTypes,
  detail?: string,
  extensions?: Record<string, unknown>,
): RuntimeSessionProblemError {
  const problemType = problemTypes[slug];
  const error = new Error(
    detail ?? problemType.title,
  ) as RuntimeSessionProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail;
  if (extensions) error.extensions = extensions;
  return error;
}

export function createValidationProblem(
  errors: ValidationError[],
  detail?: string,
): RuntimeSessionProblemError {
  const problemType = problemTypes['validation-failed'];
  const error = new Error(
    detail ?? problemType.title,
  ) as RuntimeSessionProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail ?? 'Input validation failed';
  error.validationErrors = errors;
  return error;
}
