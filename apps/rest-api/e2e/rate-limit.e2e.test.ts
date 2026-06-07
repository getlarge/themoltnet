/**
 * E2E: Rate limiting — the 429 contract end-to-end.
 *
 * Proves against the real Fastify server (real @fastify/rate-limit, real
 * onRequest lifecycle, real RFC 9457 error handler) the things that only a
 * black-box run can verify: that an exhausted bucket returns a 429 with the
 * documented Problem Details body AND the standard rate-limit headers.
 *
 * Target: POST /crypto/verify, which is public (IP-keyed) and carries its own
 * `publicVerify` per-route bucket. The e2e stack sets RATE_LIMIT_PUBLIC_VERIFY
 * very low (see docker-compose.e2e.yaml) and NO other e2e suite calls this
 * endpoint, so this suite can exhaust the bucket deterministically without
 * touching any sibling suite's budget.
 *
 * Per-identity isolation and multi-token coalescing are covered by the
 * integration test (rate-limit-keying.test.ts) — they need low per-identity
 * limits that would break sibling e2e suites if applied to the shared stack.
 *
 * NOTE: keep this the only suite that hits /crypto/verify. The bucket is a
 * 1-minute window; exhausting it here is fine because nothing else depends on it.
 */

import { createClient, verifyCryptoSignature } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

// Must match RATE_LIMIT_PUBLIC_VERIFY in docker-compose.e2e.yaml.
const PUBLIC_VERIFY_LIMIT = 5;

// An unknown signature: the handler returns 200 { valid: false } without needing
// real crypto, so each call exercises the rate limiter, not the verify logic.
const DUMMY_SIGNATURE = 'a'.repeat(88);

describe('Rate limiting (429 contract)', () => {
  let harness: TestHarness;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('returns 200 up to the limit, then a 429 with RFC 9457 body + rate-limit headers', async () => {
    // Exhaust the publicVerify bucket. The first PUBLIC_VERIFY_LIMIT requests
    // succeed; the next is throttled.
    const statuses: number[] = [];
    let throttledBody: Record<string, unknown> | undefined;
    let throttledHeaders: Headers | undefined;

    for (let i = 0; i < PUBLIC_VERIFY_LIMIT + 1; i++) {
      const { error, response } = await verifyCryptoSignature({
        client,
        body: { signature: DUMMY_SIGNATURE },
      });
      statuses.push(response.status);
      if (response.status === 429) {
        throttledBody = error as Record<string, unknown>;
        throttledHeaders = response.headers;
        break;
      }
    }

    // We hit a 429 within limit+1 requests.
    expect(statuses).toContain(429);
    // Everything before the 429 was a normal 200.
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(throttledBody).toBeDefined();
    expect(throttledHeaders).toBeDefined();

    // RFC 9457 Problem Details body.
    expect(throttledBody).toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      title: 'Rate Limit Exceeded',
    });
    expect(typeof throttledBody!.detail).toBe('string');
    expect(throttledBody!.retryAfter).toBeTypeOf('number');

    // Standard rate-limit + retry-after headers so clients can back off.
    expect(throttledHeaders!.get('retry-after')).toBeTruthy();
    expect(throttledHeaders!.get('x-ratelimit-limit')).toBe(
      String(PUBLIC_VERIFY_LIMIT),
    );
    expect(throttledHeaders!.get('x-ratelimit-remaining')).toBe('0');
    expect(throttledHeaders!.get('x-ratelimit-reset')).toBeTruthy();
  });

  it('never throttles allowlisted paths (/health) even past the limit', async () => {
    // /health is in RATE_LIMIT_ALLOWLIST, so it bypasses BOTH the pre-resolve
    // throttle and the main limiter. Hammer it well past any per-route limit and
    // confirm every call is 200 — proving the configurable allowList exempts it.
    const results = await Promise.all(
      Array.from({ length: PUBLIC_VERIFY_LIMIT * 3 }, () =>
        fetch(`${harness.baseUrl}/health`),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    // And no rate-limit headers are attached to an allowlisted response.
    expect(results[0].headers.get('x-ratelimit-limit')).toBeNull();
  });
});
