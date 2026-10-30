import { describe, expect, it } from 'vitest';

import { upstreamStatus } from '../src/utils/upstream-status.js';

describe('upstreamStatus', () => {
  it('returns the status of an Ory client response error', () => {
    const error = Object.assign(new Error('Response returned an error code'), {
      response: new Response(null, { status: 409 }),
    });

    expect(upstreamStatus(error)).toBe(409);
  });

  it.each([
    ['a network failure', new TypeError('fetch failed')],
    ['a response without a numeric status', { response: { status: '409' } }],
    ['a null response', { response: null }],
    ['a non-object value', 'boom'],
    ['null', null],
  ])('returns undefined for %s', (_name, error) => {
    expect(upstreamStatus(error)).toBeUndefined();
  });
});
