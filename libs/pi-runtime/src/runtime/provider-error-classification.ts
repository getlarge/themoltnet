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

// A provider can use 429 for both short-lived throttling and exhausted paid
// capacity. The latter cannot recover during a task retry. Keep this narrower
// than generic "quota" or "rate limit" wording so ordinary 429s still retry.
const PERMANENT_QUOTA_ERROR_PATTERNS = [
  /\b(?:reached|exceeded)\s+(?:(?:your|the)\s+)?monthly\s+usage\s+limit\b/i,
  /\bmonthly\s+(?:usage\s+)?quota\s+(?:exceeded|exhausted)\b/i,
];

const TRANSIENT_PROVIDER_ERROR_PATTERNS = [
  /\b408\b/i,
  /\b429\b/i,
  /\b5\d{2}\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\brate limit/i,
  /\btemporar(?:y|ily)\b/i,
  /\bunavailable\b/i,
  /\boverloaded\b/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bDNS\b/i,
];

const PERMANENT_REQUEST_FIELD_PATTERNS = [
  /\b(?:unsupported|unrecognized|unknown|invalid)\s+(?:request\s+)?(?:parameter|argument|field)\s*:?\s*["'`]?([A-Za-z][\w.-]*)/gi,
  /\b(?:parameter|argument|field)\s+["'`]?([A-Za-z][\w.-]*)["'`]?(?:[^\n]{0,120})\b(?:is\s+)?not\s+supported\b/gi,
];

export interface ProviderFailureContext {
  provider: string;
  model: string;
  runtimeProfileId: string;
  runtimeProfileName: string;
  runtimeProfileRevision: number | null;
  piAgentDirSource: string;
}

export interface PermanentProviderRequestDiagnostics {
  provider: string;
  model: string;
  runtimeProfileId: string;
  runtimeProfileName: string;
  runtimeProfileRevision: number | 'unknown';
  piAgentDirSource: string;
  unsupportedFields: string[];
  remediation: string | null;
}

export function isPermanentProviderRequestError(
  message: string | null | undefined,
): boolean {
  if (!message || !message.trim()) return false;
  // Provider diagnostics can contain both a request-shape phrase and an
  // authoritative status/transport signal. The transient signal wins.
  if (
    TRANSIENT_PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return false;
  }
  return PERMANENT_REQUEST_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function isPermanentProviderQuotaError(
  message: string | null | undefined,
): boolean {
  if (!message || !message.trim()) return false;
  return PERMANENT_QUOTA_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function extractPermanentProviderRequestFields(
  message: string | null | undefined,
): string[] {
  if (!message || !message.trim()) return [];
  const fields = new Set<string>();
  for (const pattern of PERMANENT_REQUEST_FIELD_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      if (match[1]) fields.add(match[1]);
    }
  }
  return [...fields];
}

export function getPermanentProviderRequestDiagnostics(
  error: { code: string; message: string; retryable?: boolean },
  context: ProviderFailureContext | undefined,
): PermanentProviderRequestDiagnostics | undefined {
  if (
    !context ||
    error.code.toLowerCase() !== 'llm_api_error' ||
    error.retryable !== false ||
    !isPermanentProviderRequestError(error.message)
  ) {
    return undefined;
  }

  const unsupportedFields = extractPermanentProviderRequestFields(
    error.message,
  );
  return {
    provider: context.provider,
    model: context.model,
    runtimeProfileId: context.runtimeProfileId,
    runtimeProfileName: context.runtimeProfileName,
    runtimeProfileRevision: context.runtimeProfileRevision ?? 'unknown',
    piAgentDirSource: context.piAgentDirSource,
    unsupportedFields,
    remediation:
      unsupportedFields.length > 0
        ? 'remove or disable these fields in the active Pi model/profile ' +
          'configuration, or select a provider/model that supports them, ' +
          'then retry.'
        : null,
  };
}

export function appendPermanentProviderRequestDiagnostics<
  T extends { code: string; message: string; retryable?: boolean },
>(error: T, context: ProviderFailureContext | undefined): T {
  const diagnostics = getPermanentProviderRequestDiagnostics(error, context);
  if (!diagnostics || error.message.includes('Provider/model:')) {
    return error;
  }

  const contextMessage =
    ` Provider/model: ${diagnostics.provider}/${diagnostics.model}.` +
    ` Runtime profile: ${diagnostics.runtimeProfileName} (${diagnostics.runtimeProfileId}),` +
    ` revision ${diagnostics.runtimeProfileRevision}.` +
    ` Pi config source: ${diagnostics.piAgentDirSource}.`;
  const fieldsMessage =
    diagnostics.unsupportedFields.length > 0
      ? ` Unsupported request field(s): ${diagnostics.unsupportedFields.join(', ')}.`
      : '';
  const remediationMessage = diagnostics.remediation
    ? ` Remediation: ${diagnostics.remediation}`
    : '';
  const suffix = `${contextMessage}${fieldsMessage}${remediationMessage}`;

  return {
    ...error,
    message: `${error.message.slice(
      0,
      Math.max(0, 4000 - suffix.length),
    )}${suffix}`,
  };
}
