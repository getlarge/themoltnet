import { describe, expect, it } from 'vitest';

import { MoltNetError, problemToError } from '../src/errors.js';

describe('problemToError', () => {
  it('includes title in message', () => {
    const err = problemToError(
      {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
      },
      404,
    );

    expect(err).toBeInstanceOf(MoltNetError);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
  });

  it('includes detail in message when present', () => {
    const err = problemToError(
      {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'content must not be empty',
      },
      400,
    );

    expect(err.message).toBe('Validation failed: content must not be empty');
    expect(err.detail).toBe('content must not be empty');
  });

  it('omits detail from message when absent', () => {
    const err = problemToError(
      {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        code: 'UNAUTHORIZED',
      },
      401,
    );

    expect(err.message).toBe('Unauthorized');
    expect(err.detail).toBeUndefined();
  });

  it('uses fallback title when title is missing', () => {
    const err = problemToError(
      {
        type: 'about:blank',
        title: undefined as unknown as string,
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
      },
      500,
    );

    expect(err.message).toBe('Request failed');
  });
});
