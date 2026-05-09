import { describe, expect, it } from 'vitest';

import { unwrapResult } from '../src/agent-context.js';
import { MoltNetError, NetworkError } from '../src/errors.js';

describe('unwrapResult', () => {
  it('returns data from successful results', () => {
    expect(unwrapResult({ data: { ok: true } })).toEqual({ ok: true });
  });

  it('preserves server ProblemDetails as MoltNetError', () => {
    expect(() =>
      unwrapResult({
        error: {
          type: 'urn:moltnet:problem:validation-failed',
          title: 'Validation failed',
          status: 400,
          code: 'VALIDATION_FAILED',
          detail: 'content must not be empty',
        },
      }),
    ).toThrow(
      new MoltNetError('Validation failed: content must not be empty', {
        code: 'urn:moltnet:problem:validation-failed',
        statusCode: 400,
        detail: 'content must not be empty',
      }),
    );
  });

  it('wraps transport errors as NetworkError with the original message', () => {
    const transportError = new TypeError('fetch failed', {
      cause: new Error('ECONNRESET'),
    });

    expect(() => unwrapResult({ error: transportError })).toThrow(NetworkError);

    try {
      unwrapResult({ error: transportError });
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).message).toBe('fetch failed');
      expect((error as NetworkError).code).toBe('NETWORK_ERROR');
      expect((error as NetworkError).detail).toBe('Error: ECONNRESET');
      expect((error as NetworkError).stack).toBe(transportError.stack);
    }
  });

  it('does not label response-bound raw errors as network failures', () => {
    expect(() =>
      unwrapResult({
        error: new Error('interceptor failed'),
        response: new Response('bad gateway', { status: 502 }),
      }),
    ).toThrow(
      new MoltNetError(
        'Unexpected error from MoltNet API: Error: interceptor failed',
        { code: 'UNKNOWN' },
      ),
    );
  });

  it('surfaces opaque errors without falling back to Request failed', () => {
    expect(() =>
      unwrapResult({
        error: {
          reason: 'malformed client error',
        },
      }),
    ).toThrow(
      new MoltNetError(
        'Unexpected error from MoltNet API: {"reason":"malformed client error"}',
        { code: 'UNKNOWN' },
      ),
    );
  });

  it('throws EMPTY_RESPONSE when neither data nor error is present', () => {
    expect(() => unwrapResult({})).toThrow(
      new MoltNetError('Unexpected empty response from MoltNet API', {
        code: 'EMPTY_RESPONSE',
      }),
    );
  });
});
