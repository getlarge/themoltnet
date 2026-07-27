export type SigningServiceErrorCode =
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'signing_request_already_completed'
  | 'signing_request_expired'
  | 'signing_request_limit_reached'
  | 'validation_failed';

export interface SigningServiceErrorOptions extends ErrorOptions {
  retryAfterSeconds?: number;
}

export class SigningServiceError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: SigningServiceErrorCode,
    message: string,
    options?: SigningServiceErrorOptions,
  ) {
    super(message, options);
    this.name = 'SigningServiceError';
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}
