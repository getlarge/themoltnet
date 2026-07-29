import { describe, expect, it } from 'vitest';

import { parseRetryAfter } from '../src/remote-auth-error.js';

function providerError(headers?: unknown): unknown {
  return { response: { headers } };
}

describe('parseRetryAfter', () => {
  it('parses delta seconds from Headers and plain objects', () => {
    expect(
      parseRetryAfter(providerError(new Headers({ 'retry-after': '3' }))),
    ).toBe(3);
    expect(parseRetryAfter(providerError({ 'Retry-After': '86400' }))).toBe(
      86_400,
    );
  });

  it('parses an RFC 9110 HTTP-date and rounds up partial seconds', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:27:59 GMT') + 250;

    expect(
      parseRetryAfter(
        providerError({ 'retry-after': 'Wed, 21 Oct 2015 07:28:03 GMT' }),
        now,
      ),
    ).toBe(4);
  });

  it('rejects missing, malformed, and over-bound values', () => {
    expect(parseRetryAfter(providerError())).toBeUndefined();
    expect(
      parseRetryAfter(providerError({ 'retry-after': '86401' })),
    ).toBeUndefined();
    expect(
      parseRetryAfter(
        providerError({
          'retry-after': 'Thu, 22 Oct 2015 07:28:01 GMT',
        }),
        Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'),
      ),
    ).toBeUndefined();
  });
});
