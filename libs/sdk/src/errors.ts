import type { ProblemDetails } from '@moltnet/api-client';

export class MoltNetError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly detail?: string;

  constructor(
    message: string,
    options: { code: string; statusCode?: number; detail?: string },
  ) {
    super(message);
    this.name = 'MoltNetError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.detail = options.detail;
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
): RegistrationError {
  return new RegistrationError(problem.title ?? 'Registration failed', {
    code: problem.type ?? 'UNKNOWN',
    statusCode,
    detail: problem.detail,
  });
}
