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
  /\b[a-z_][\w.-]{0,64}\s*:\s*\d{1,8}\b[^\n]{0,100}\bnot\s+supported\b/i,
];

// Only status text at the start of a provider diagnostic is authoritative.
// A request field or request ID can contain a status-looking token.
const LEADING_STATUS_PATTERN =
  /^\s*(?:(?:HTTP(?:\/\d+(?:\.\d+)?)?|status(?: code)?|provider returned(?: error)?|response|(?:API\s+)?error)\s*[:=]?\s*)?([1-5]\d{2})\b/i;
// Pi formats these errors with a named API prefix before the status.
const PI_API_STATUS_PATTERN =
  /^\s*[\w ]{1,48}API error\s*\(([1-5]\d{2})\)\s*:/i;
const REQUEST_STATUS_PATTERN =
  /^\s*Request failed with status code\s+([1-5]\d{2})\b/i;
const LEADING_TRANSPORT_PATTERN =
  /^\s*(?:(?:request|connection)\s+)?(?:timed?\s*out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network error|service unavailable|overloaded)\b/i;
// Pi's private deny-list is broader than terminal account exhaustion. Keep
// this list to durable account limits; generic quota/per-minute wording is
// allowed to retry, including responses with a retry-after hint.
const MONTHLY_QUOTA_PATTERN =
  /\b(?:monthly usage limit reached|(?:reached|exceeded)\s+(?:(?:your|the)\s+)?monthly\s+usage\s+limit|monthly\s+(?:usage\s+)?quota\s+(?:exceeded|exhausted))\b/i;
const ACCOUNT_QUOTA_PATTERN =
  /\b(?:insufficient_quota|insufficient credits?|out of budget|billing_hard_limit_reached|billing (?:limit|quota|required|error)|available balance|credit balance is too low|GoUsageLimitError|FreeUsageLimitError)\b/i;
const TIME_WINDOW_PATTERN =
  /\b(?:per\s+(?:second|minute|hour|day)|retry\s+(?:in|after)|try again in|retry-after)\b/i;
const PROVIDER_AUTH_PATTERN =
  /\b(?:unauthori[sz]ed|forbidden|invalid (?:api )?key|missing credentials?)\b/i;
const PROVIDER_MODEL_PATTERN =
  /\b(?:model [^\n]{0,120}(?:not (?:found|registered|available)|does not exist)|unknown model)\b/i;
const VALIDATION_FAILURE_PATTERN =
  /^\s*(?:(?:[1-4]\d{2}|error)\s*[: -]\s*)?(?:request )?validation failed\b/i;
const CANCELLED_PATTERN = /^\s*(?:request (?:was )?)?cancell?ed\b/i;

const REQUEST_DESCRIPTORS = new Set([
  'unsupported',
  'unrecognized',
  'unknown',
  'invalid',
]);
const REQUEST_FIELD_KINDS = new Set(['parameter', 'argument', 'field']);
const MAX_DIAGNOSTIC_LENGTH = 4000;
const MAX_JSON_ENVELOPE_LENGTH = 4096;
const MAX_FIELDS = 8;
const MAX_FIELD_LENGTH = 64;

export const PROVIDER_FAILURE_CODES = {
  apiError: 'llm_api_error',
  requestRejected: 'llm_request_rejected',
  requestCancelled: 'llm_request_cancelled',
  quotaExhausted: 'llm_quota_exhausted',
  authError: 'llm_auth_error',
  invalidModel: 'invalid_model',
} as const;
export type ProviderFailureCode =
  (typeof PROVIDER_FAILURE_CODES)[keyof typeof PROVIDER_FAILURE_CODES];

export interface ProviderFailureVerdict {
  code: ProviderFailureCode;
  retryable: boolean;
  reason:
    | 'request_rejected'
    | 'quota_exhausted'
    | 'auth_error'
    | 'model_invalid'
    | 'cancelled'
    | 'transient_status'
    | 'transient_transport'
    | 'unknown';
}

function leadingStatus(message: string): number | null {
  const match =
    LEADING_STATUS_PATTERN.exec(message) ??
    PI_API_STATUS_PATTERN.exec(message) ??
    REQUEST_STATUS_PATTERN.exec(message);
  return match?.[1] ? Number(match[1]) : null;
}

function jsonStatus(message: string): number | null {
  if (message.length > MAX_JSON_ENVELOPE_LENGTH) return null;
  const trimmed = message.trimStart();
  const prefix = /^Provider returned error:\s*/i.exec(trimmed)?.[0];
  const json = prefix ? trimmed.slice(prefix.length) : trimmed;
  if (!json.startsWith('{') && !json.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof root !== 'object' || root === null) return null;
    const outer = root as Record<string, unknown>;
    const payload = outer.error;
    const error =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : outer;
    const code = error.code;
    return typeof code === 'number' && code >= 100 && code <= 599 ? code : null;
  } catch {
    return null;
  }
}

/** One verdict for same-session retries and the terminal TaskError. */
export function classifyProviderFailure(
  message: string | null | undefined,
): ProviderFailureVerdict {
  if (!message?.trim()) {
    return {
      code: PROVIDER_FAILURE_CODES.apiError,
      retryable: true,
      reason: 'unknown',
    };
  }
  const status = leadingStatus(message) ?? jsonStatus(message);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    if (status === 429 && isPermanentProviderQuotaError(message)) {
      return {
        code: PROVIDER_FAILURE_CODES.quotaExhausted,
        retryable: false,
        reason: 'quota_exhausted',
      };
    }
    return {
      code: PROVIDER_FAILURE_CODES.apiError,
      retryable: true,
      reason: 'transient_status',
    };
  }
  if (LEADING_TRANSPORT_PATTERN.test(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.apiError,
      retryable: true,
      reason: 'transient_transport',
    };
  }
  if (status === 402 || isPermanentProviderQuotaError(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.quotaExhausted,
      retryable: false,
      reason: 'quota_exhausted',
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: PROVIDER_FAILURE_CODES.authError,
      retryable: false,
      reason: 'auth_error',
    };
  }
  if (PROVIDER_MODEL_PATTERN.test(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.invalidModel,
      retryable: false,
      reason: 'model_invalid',
    };
  }
  if (isPermanentProviderRequestError(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.requestRejected,
      retryable: false,
      reason: 'request_rejected',
    };
  }
  if (VALIDATION_FAILURE_PATTERN.test(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.requestRejected,
      retryable: false,
      reason: 'request_rejected',
    };
  }
  if (CANCELLED_PATTERN.test(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.requestCancelled,
      retryable: false,
      reason: 'cancelled',
    };
  }
  if (isProviderAuthError(message)) {
    return {
      code: PROVIDER_FAILURE_CODES.authError,
      retryable: false,
      reason: 'auth_error',
    };
  }
  // Unknown errors get one bounded same-session continuation. Pi's broad
  // substring matcher is deliberately not authoritative for request fields.
  return {
    code: PROVIDER_FAILURE_CODES.apiError,
    retryable: true,
    reason: 'unknown',
  };
}

export interface ProviderFailureContext {
  provider: string;
  model: string;
  runtimeProfileId: string;
  runtimeProfileName: string;
  runtimeProfileRevision: number | null;
  piAgentDirSource: 'env' | 'store' | 'repo';
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
  if (!message?.trim()) return false;
  return PERMANENT_REQUEST_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function isPermanentProviderQuotaError(
  message: string | null | undefined,
): boolean {
  return Boolean(
    message &&
    (MONTHLY_QUOTA_PATTERN.test(message) ||
      (ACCOUNT_QUOTA_PATTERN.test(message) &&
        !TIME_WINDOW_PATTERN.test(message))),
  );
}

export function isProviderAuthError(message: string): boolean {
  return PROVIDER_AUTH_PATTERN.test(message);
}

export function extractPermanentProviderRequestFields(
  message: string | null | undefined,
): string[] {
  if (!message || !message.trim()) return [];
  const fields = new Set<string>();
  // Provider text is untrusted. Bound the scan and use a single-pass token
  // parser rather than overlapping optional regex groups on long whitespace.
  for (const line of message.slice(0, MAX_DIAGNOSTIC_LENGTH).split(/\r?\n/)) {
    const tokens = line.match(/[A-Za-z][\w.-]*|:/g) ?? [];
    const lower = tokens.map((token) => token.toLowerCase());
    for (let i = 0; i < tokens.length; i++) {
      if (REQUEST_DESCRIPTORS.has(lower[i])) {
        let kind = i + 1;
        if (lower[kind] === 'request') kind++;
        if (!REQUEST_FIELD_KINDS.has(lower[kind])) continue;
        const field = tokens[kind + (tokens[kind + 1] === ':' ? 2 : 1)];
        if (field && field !== ':' && field.toLowerCase() !== 'is') {
          fields.add(field.slice(0, MAX_FIELD_LENGTH));
        }
        if (fields.size >= MAX_FIELDS) return [...fields];
        continue;
      }
      if (!REQUEST_FIELD_KINDS.has(lower[i])) continue;
      const field = tokens[i + 1];
      if (!field || field === ':') continue;
      const suffix = lower.slice(i + 2, i + 8).join(' ');
      if (suffix.includes('not supported')) {
        fields.add(field.slice(0, MAX_FIELD_LENGTH));
      }
      if (fields.size >= MAX_FIELDS) return [...fields];
    }
  }
  return [...fields].slice(0, MAX_FIELDS);
}

export function getPermanentProviderRequestDiagnostics(
  message: string,
  context: ProviderFailureContext | undefined,
  code: ProviderFailureCode = PROVIDER_FAILURE_CODES.requestRejected,
): PermanentProviderRequestDiagnostics | undefined {
  if (!context) return undefined;

  const unsupportedFields = extractPermanentProviderRequestFields(message);
  return {
    provider: context.provider,
    model: context.model,
    runtimeProfileId: context.runtimeProfileId,
    runtimeProfileName: context.runtimeProfileName,
    runtimeProfileRevision: context.runtimeProfileRevision ?? 'unknown',
    piAgentDirSource: context.piAgentDirSource,
    unsupportedFields,
    remediation:
      code === PROVIDER_FAILURE_CODES.invalidModel
        ? 'select a model available from the configured provider, then retry.'
        : unsupportedFields.length > 0
          ? 'remove or disable these fields in the active Pi model/profile ' +
            'configuration, or select a provider/model that supports them, ' +
            'then retry.'
          : null,
  };
}

export function appendPermanentProviderRequestDiagnostics<
  T extends { code: string; message: string; retryable?: boolean },
>(error: T, context: ProviderFailureContext | undefined): T {
  if (
    (error.code !== PROVIDER_FAILURE_CODES.requestRejected &&
      error.code !== PROVIDER_FAILURE_CODES.invalidModel) ||
    error.retryable
  )
    return error;
  const diagnostics = getPermanentProviderRequestDiagnostics(
    error.message,
    context,
    error.code as ProviderFailureCode,
  );
  if (!diagnostics) {
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
  const suffix = `${contextMessage}${fieldsMessage}${remediationMessage}`.slice(
    0,
    MAX_DIAGNOSTIC_LENGTH,
  );

  return {
    ...error,
    message: `${error.message.slice(0, MAX_DIAGNOSTIC_LENGTH - suffix.length)}${suffix}`,
  };
}
