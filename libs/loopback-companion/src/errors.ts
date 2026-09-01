/**
 * Typed violations raised by the loopback-companion security scaffolding.
 *
 * Consumers (the signer, the agent-daemon `serve` supervisor) translate the
 * `kind` into their own protocol error codes and HTTP statuses; the lib
 * never assumes a response shape.
 */
export type LoopbackViolationKind =
  | 'host_required'
  | 'host_not_loopback'
  | 'origin_required'
  | 'origin_invalid'
  | 'origin_not_allowed'
  | 'body_not_utf8_json'
  | 'navigation_required'
  | 'cross_site_rejected';

export class LoopbackViolationError extends Error {
  override name = 'LoopbackViolationError';

  constructor(
    readonly kind: LoopbackViolationKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function isLoopbackViolation(
  error: unknown,
): error is LoopbackViolationError {
  return error instanceof LoopbackViolationError;
}
