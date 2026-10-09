import type {
  RemoteAuthMetrics,
  RemoteAuthOperation,
} from './remote-auth-cache.js';

export class RemoteAuthenticationError extends Error {
  readonly kind: 'rate_limited' | 'unavailable';
  readonly operation: RemoteAuthOperation;
  readonly retryAfter?: number;

  constructor(
    kind: 'rate_limited' | 'unavailable',
    operation: RemoteAuthOperation,
    retryAfter?: number,
  ) {
    super(`Remote authentication ${operation} ${kind}`);
    this.name = 'RemoteAuthenticationError';
    this.kind = kind;
    this.operation = operation;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export function remoteErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.status === 'number') return candidate.status;
  return typeof candidate.response?.status === 'number'
    ? candidate.response.status
    : undefined;
}

const ORY_ERROR_TYPES = new Set([
  'AbortError',
  'AggregateError',
  'BodyTimeoutError',
  'ConnectTimeoutError',
  'Error',
  'FetchError',
  'HeadersTimeoutError',
  'RequiredError',
  'ResponseError',
  'SocketError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
]);

const TRANSPORT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EPROTO',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function knownErrorType(value: unknown): string | undefined {
  return typeof value === 'string' && ORY_ERROR_TYPES.has(value)
    ? value
    : undefined;
}

function knownTransportCode(value: unknown): string | undefined {
  return typeof value === 'string' && TRANSPORT_ERROR_CODES.has(value)
    ? value
    : undefined;
}

/** Bounded Ory SDK error details; unknown strings and raw messages stay out. */
export function summarizeOryError(error: unknown): {
  errorType: string;
  status?: number;
  causeType?: string;
  causeCode?: string;
} {
  if (typeof error !== 'object' || error === null) {
    return { errorType: 'UnknownError' };
  }

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    cause?: {
      name?: unknown;
      code?: unknown;
      cause?: { code?: unknown };
    };
  };
  const cause = candidate.cause;
  const causeCode =
    knownTransportCode(cause?.code) ??
    knownTransportCode(cause?.cause?.code) ??
    knownTransportCode(candidate.code);
  const causeType = knownErrorType(cause?.name);
  const status = remoteErrorStatus(error);
  return {
    errorType: knownErrorType(candidate.name) ?? 'UnknownError',
    ...(status !== undefined ? { status } : {}),
    ...(causeType ? { causeType } : {}),
    ...(causeCode ? { causeCode } : {}),
  };
}

export function parseRetryAfter(
  error: unknown,
  nowMs = Date.now(),
): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = (error as { response?: { headers?: unknown } }).response
    ?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const value = (() => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get('retry-after');
    }
    const entry = Object.entries(headers as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === 'retry-after',
    );
    return entry?.[1];
  })();
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d{1,6}$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) && seconds <= 86_400
      ? seconds
      : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  const seconds = Math.max(0, Math.ceil((dateMs - nowMs) / 1_000));
  return seconds <= 86_400 ? seconds : undefined;
}

export function asRemoteAuthenticationError(
  error: unknown,
  operation: RemoteAuthOperation,
  metrics: RemoteAuthMetrics,
): RemoteAuthenticationError {
  const status = remoteErrorStatus(error);
  if (status === 429) {
    metrics.recordUpstreamRequest(operation, 'rate_limited', status);
    return new RemoteAuthenticationError(
      'rate_limited',
      operation,
      parseRetryAfter(error),
    );
  }
  metrics.recordUpstreamRequest(operation, 'unavailable', status);
  return new RemoteAuthenticationError('unavailable', operation);
}
