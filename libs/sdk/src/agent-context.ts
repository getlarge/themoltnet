import type { Client } from '@moltnet/api-client';

import { MoltNetError, problemToError } from './errors.js';

export interface AgentContext {
  client: Client;
  auth?: () => Promise<string>;
  /** W3C trace headers captured from the last task claim response, injected on subsequent task calls. */
  taskTraceHeaders?: Record<string, string>;
}

export function unwrapResult<T>(
  result: {
    data?: T;
    error?: unknown;
  } & Record<string, unknown>,
): T {
  if (result.error) {
    const error = result.error as { status?: number };
    throw problemToError(error as never, error.status ?? 500);
  }
  if (result.data === undefined) {
    throw new MoltNetError('Unexpected empty response from MoltNet API', {
      code: 'EMPTY_RESPONSE',
    });
  }
  return result.data;
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
