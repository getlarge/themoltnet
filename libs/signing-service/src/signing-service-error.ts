export type SigningServiceErrorCode =
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'signing_request_already_completed'
  | 'signing_request_expired'
  | 'signing_request_limit_reached'
  | 'validation_failed';

export class SigningServiceError extends Error {
  constructor(
    readonly code: SigningServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SigningServiceError';
  }
}
