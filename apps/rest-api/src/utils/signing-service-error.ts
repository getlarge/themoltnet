import { SigningServiceError } from '@moltnet/signing-service';

import { createProblem } from '../problems/index.js';

export function throwSigningServiceProblem(error: unknown): never {
  if (error instanceof SigningServiceError) {
    const problemByCode = {
      conflict: 'conflict',
      forbidden: 'forbidden',
      not_found: 'not-found',
      signing_request_already_completed: 'signing-request-already-completed',
      signing_request_expired: 'signing-request-expired',
      signing_request_limit_reached: 'signing-request-limit-reached',
      validation_failed: 'validation-failed',
    } as const;
    throw createProblem(
      problemByCode[error.code],
      error.message,
      error.retryAfterSeconds === undefined
        ? undefined
        : { retryAfter: error.retryAfterSeconds },
    );
  }
  throw error;
}
