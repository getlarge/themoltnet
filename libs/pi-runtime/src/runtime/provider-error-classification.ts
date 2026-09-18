/**
 * Return true for provider messages that describe a request shape the
 * selected model cannot accept. These failures are deterministic until the
 * request or runtime profile changes and must not consume retry budget.
 *
 * Keep this deliberately narrow: generic 4xx responses and ordinary
 * validation errors can still be transient provider failures, while these
 * phrases are the stable wording used by provider APIs for unsupported
 * request fields.
 */
const PERMANENT_REQUEST_ERROR_PATTERNS = [
  /\b(?:unsupported|unrecognized|unknown|invalid)\s+(?:request\s+)?(?:parameter|argument|field)\b/i,
  /\b(?:parameter|argument|field)\b[^\n]{0,120}\b(?:is\s+)?not\s+supported\b/i,
];

export function isPermanentProviderRequestError(
  message: string | null | undefined,
): boolean {
  if (!message || !message.trim()) return false;
  return PERMANENT_REQUEST_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}
