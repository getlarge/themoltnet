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
