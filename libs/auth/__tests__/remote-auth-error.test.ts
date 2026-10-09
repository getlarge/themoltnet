import { ApiKeysApi, Configuration } from '@ory/client-fetch';
import { describe, expect, it } from 'vitest';

import {
  parseRetryAfter,
  summarizeOryError,
} from '../src/remote-auth-error.js';

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

function verifierWithFetch(fetchApi: NonNullable<Configuration['fetchApi']>) {
  return new ApiKeysApi(
    new Configuration({ basePath: 'https://ory.example.test', fetchApi }),
  );
}

async function verify(api: ApiKeysApi) {
  return api.adminVerifyApiKey({
    verifyApiKeyRequest: { credential: 'redacted-test-key' },
  });
}

describe('summarizeOryError', () => {
  it('recognizes the installed Ory SDK timeout wrapper', async () => {
    const api = verifierWithFetch(async () => {
      throw new DOMException('private timeout detail', 'TimeoutError');
    });

    try {
      await verify(api);
      expect.fail('verification should fail');
    } catch (error) {
      expect(summarizeOryError(error)).toEqual({
        errorType: 'FetchError',
        causeType: 'TimeoutError',
      });
    }
  });

  it('recognizes a nested fetch transport code', async () => {
    const api = verifierWithFetch(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('private socket detail'), {
          code: 'ECONNRESET',
        }),
      });
    });

    try {
      await verify(api);
      expect.fail('verification should fail');
    } catch (error) {
      expect(summarizeOryError(error)).toEqual({
        errorType: 'FetchError',
        causeType: 'TypeError',
        causeCode: 'ECONNRESET',
      });
    }
  });

  it('keeps HTTP response errors distinct from fetch failures', async () => {
    const api = verifierWithFetch(
      async () => new Response('{}', { status: 503 }),
    );

    try {
      await verify(api);
      expect.fail('verification should fail');
    } catch (error) {
      expect(summarizeOryError(error)).toEqual({
        errorType: 'ResponseError',
        status: 503,
      });
    }
  });

  it('does not copy arbitrary error names or codes into logs', () => {
    const error = Object.assign(new Error('private message'), {
      name: 'private_name',
      cause: {
        name: 'private_cause',
        code: 'private_code',
        cause: { code: 'private_nested_code' },
      },
    });

    expect(summarizeOryError(error)).toEqual({ errorType: 'UnknownError' });
  });
});
