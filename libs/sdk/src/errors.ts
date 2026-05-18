import type { ProblemDetails } from '@moltnet/api-client';

/**
 * One field-level validation error surfaced by the rest-api when a
 * request body fails schema or cross-field validation. Mirrors the
 * server's `ValidationProblemDetails.errors[]` entries.
 */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export class MoltNetError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly detail?: string;
  /**
   * Populated when the server returned a `VALIDATION_FAILED` problem
   * (status 400) with field-level errors. Empty / undefined for every
   * other problem kind. Imposer scripts surface these to operators so
   * they don't have to re-run with curl to see what was rejected.
   */
  readonly validationErrors?: readonly ValidationError[];

  constructor(
    message: string,
    options: {
      code: string;
      statusCode?: number;
      detail?: string;
      validationErrors?: readonly ValidationError[];
    },
  ) {
    super(message);
    this.name = 'MoltNetError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.detail = options.detail;
    this.validationErrors = options.validationErrors;
  }
}

export class RegistrationError extends MoltNetError {
  constructor(
    message: string,
    options: { code: string; statusCode: number; detail?: string },
  ) {
    super(message, options);
    this.name = 'RegistrationError';
  }
}

export class NetworkError extends MoltNetError {
  constructor(message: string, options?: { detail?: string }) {
    super(message, {
      code: 'NETWORK_ERROR',
      detail: options?.detail,
    });
    this.name = 'NetworkError';
  }
}

export class AuthenticationError extends MoltNetError {
  constructor(
    message: string,
    options?: { statusCode?: number; detail?: string },
  ) {
    super(message, {
      code: 'AUTH_FAILED',
      statusCode: options?.statusCode,
      detail: options?.detail,
    });
    this.name = 'AuthenticationError';
  }
}

export function problemToError(
  problem: ProblemDetails,
  statusCode: number,
): MoltNetError {
  const title = problem.title ?? 'Request failed';
  const message = problem.detail ? `${title}: ${problem.detail}` : title;
  // The server's VALIDATION_FAILED problems carry a non-standard
  // `errors[]` array (per `apps/rest-api/src/plugins/error-handler.ts`).
  // ProblemDetails on @moltnet/api-client doesn't type it because RFC
  // 7807 doesn't, so we coerce defensively and keep only entries with
  // the expected shape.
  const rawErrors = (problem as unknown as { errors?: unknown }).errors;
  const validationErrors = Array.isArray(rawErrors)
    ? rawErrors.filter(
        (e): e is ValidationError =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { field?: unknown }).field === 'string' &&
          typeof (e as { message?: unknown }).message === 'string',
      )
    : undefined;
  return new MoltNetError(message, {
    code: problem.type ?? problem.code ?? 'UNKNOWN',
    statusCode,
    detail: problem.detail,
    validationErrors,
  });
}
