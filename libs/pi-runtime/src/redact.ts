const REDACTED = '[redacted]';

/**
 * Replace values matching well-known credential shapes.
 *
 * Shape matching only: it catches the common accident (a pasted token, a
 * bearer header, an `env` dump) and nothing else. It is not a guarantee that a
 * string is free of secrets, and must never be described as one. Content-aware
 * processing is #1294's job; this is the cheap layer that composes with it.
 */
export function redactKnownSecretShapes(value: string): string {
  return value
    .replace(/((?:bearer|basic)\s+)[a-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`)
    .replace(/\bgh[pousr]_[a-z0-9_]{20,}\b/gi, REDACTED)
    .replace(/\bsk-[a-z0-9_-]{16,}\b/gi, REDACTED)
    .replace(
      /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\b/gi,
      REDACTED,
    );
}

export { REDACTED };
