import type {
  RemoteAuthMetrics,
  RemoteAuthOperation,
} from './remote-auth-cache.js';

export class RemoteAuthenticationError extends Error {
  readonly statusCode: 429 | 503;
  readonly code: 'RATE_LIMIT_EXCEEDED' | 'SERVICE_UNAVAILABLE';
  readonly detail: string;
  readonly retryAfter?: number;

  constructor(statusCode: 429 | 503, retryAfter?: number) {
    const rateLimited = statusCode === 429;
    const detail = rateLimited
      ? 'Authentication provider rate limit exceeded'
      : 'Authentication provider unavailable';
    super(detail);
    this.name = 'RemoteAuthenticationError';
    this.statusCode = statusCode;
    this.code = rateLimited ? 'RATE_LIMIT_EXCEEDED' : 'SERVICE_UNAVAILABLE';
    this.detail = detail;
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

function retryAfter(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = (error as { response?: { headers?: unknown } }).response
    ?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const value =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, unknown>)['retry-after'];
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400
    ? seconds
    : undefined;
}

export function asRemoteAuthenticationError(
  error: unknown,
  operation: RemoteAuthOperation,
  metrics: RemoteAuthMetrics,
): RemoteAuthenticationError {
  const status = remoteErrorStatus(error);
  if (status === 429) {
    metrics.recordUpstreamRequest(operation, 'rate_limited', status);
    return new RemoteAuthenticationError(429, retryAfter(error));
  }
  metrics.recordUpstreamRequest(operation, 'unavailable', status);
  return new RemoteAuthenticationError(503);
}
