export type PreviewSignErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_DEVICE'
  | 'UNTRUSTED_ENROLLMENT'
  | 'INVALID_RESPONSE'
  | 'VERIFICATION_FAILED';

export class PreviewSignError extends Error {
  readonly code: PreviewSignErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: PreviewSignErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PreviewSignError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(
  condition: unknown,
  code: PreviewSignErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (!condition) throw new PreviewSignError(code, message, details);
}
