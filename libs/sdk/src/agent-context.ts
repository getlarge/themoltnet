import type { Client, Config, ProblemDetails } from '@moltnet/api-client';

import { MoltNetError, NetworkError, problemToError } from './errors.js';

export interface AgentContext {
  client: Client;
  auth?: Config['auth'];
}

export function unwrapResult<T>(
  result: {
    data?: T;
    error?: unknown;
    response?: unknown;
  } & Record<string, unknown>,
): T {
  if (result.error !== undefined && result.error !== null) {
    const error = result.error;

    if (isProblemDetails(error)) {
      throw problemToError(error, error.status);
    }

    if (error instanceof Error && result.response === undefined) {
      const networkError = new NetworkError(error.message, {
        detail: error.cause ? stringifyUnknown(error.cause) : undefined,
      });
      networkError.stack = error.stack;
      throw networkError;
    }

    throw new MoltNetError(
      `Unexpected error from MoltNet API: ${stringifyUnknown(error)}`,
      { code: 'UNKNOWN' },
    );
  }
  if (result.data === undefined) {
    throw new MoltNetError('Unexpected empty response from MoltNet API', {
      code: 'EMPTY_RESPONSE',
    });
  }
  return result.data;
}

function isProblemDetails(error: unknown): error is ProblemDetails {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { status?: unknown };
  return (
    typeof candidate.status === 'number' &&
    ('title' in error || 'detail' in error)
  );
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

export function unwrapRequired<T>(
  result: {
    data?: T;
    error?: unknown;
  } & Record<string, unknown>,
  message: string,
  code: string,
): T {
  if (result.error || !result.data) {
    throw new MoltNetError(message, { code });
  }
  return result.data;
}
