export type CtapErrorCode =
  | 'INVALID_INPUT'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_AMBIGUOUS'
  | 'USER_PRESENCE_TIMEOUT'
  | 'TRANSPORT_ERROR'
  | 'CTAP_ERROR'
  | 'INVALID_RESPONSE';

export class CtapError extends Error {
  readonly code: CtapErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: CtapErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CtapError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(
  condition: unknown,
  code: CtapErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (!condition) {
    throw new CtapError(code, message, details);
  }
}
