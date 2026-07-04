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

import {
  createClient,
  createTask,
  listTasks,
  verifyCryptoSignature,
} from '@moltnet/api-client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

// Host port for the e2e redis (docker-compose.e2e.yaml maps 6380->6379).
const REDIS_HOST_PORT = 6380;
// Must match REDIS_NAMESPACE in apps/rest-api/src/plugins/rate-limit.ts.
const REDIS_NAMESPACE = 'moltnet-rl-';

// Must match docker-compose.e2e.yaml.
const READ_LIMIT = 7000;
const GLOBAL_AUTH_LIMIT = 10000;

// Must match RATE_LIMIT_PUBLIC_VERIFY in docker-compose.e2e.yaml.
const PUBLIC_VERIFY_LIMIT = 5;

// An unknown signature: the handler returns 200 { valid: false } without needing
// real crypto, so each call exercises the rate limiter, not the verify logic.
const DUMMY_SIGNATURE = 'a'.repeat(88);

async function clearE2eRateLimitKeys(): Promise<void> {
  const redis = new Redis({ host: '127.0.0.1', port: REDIS_HOST_PORT });
  try {
    const keys = await redis.keys(`${REDIS_NAMESPACE}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    await redis.quit();
  }
}

describe('Rate limiting (429 contract)', () => {
  let harness: TestHarness;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await clearE2eRateLimitKeys();
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

describe('Rate limiting read/write split (#1336 part 2)', () => {
  let harness: TestHarness;
  let client: ReturnType<typeof createClient>;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('serves authenticated reads from a distinct, more generous bucket than mutations', async () => {
    // A GET read (in the 'read' group) reports the read limit...
    const readRes = await listTasks({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
    });
    expect(readRes.response.status).toBe(200);
    expect(readRes.response.headers.get('x-ratelimit-limit')).toBe(
      String(READ_LIMIT),
    );

    // ...a mutation (POST /tasks, global bucket) reports the global auth limit.
    // The create may fail validation/business rules, but the limiter header is
    // stamped regardless and must reflect the SEPARATE global bucket.
    const writeRes = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {} as never,
    });
    expect(writeRes.response.headers.get('x-ratelimit-limit')).toBe(
      String(GLOBAL_AUTH_LIMIT),
    );

    // The two buckets are distinct — reads are not capped at the mutation limit.
    expect(READ_LIMIT).not.toBe(GLOBAL_AUTH_LIMIT);
    expect(readRes.response.headers.get('x-ratelimit-limit')).not.toBe(
      writeRes.response.headers.get('x-ratelimit-limit'),
    );
  });
});

describe('Rate limiting Redis-backed store (#1336 part 3)', () => {
  let harness: TestHarness;
  let client: ReturnType<typeof createClient>;
  let redis: Redis;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    redis = new Redis({ host: '127.0.0.1', port: REDIS_HOST_PORT });
  });

  afterAll(async () => {
    await redis?.quit();
    await harness?.teardown();
  });

  it('persists rate-limit counters in Redis under the configured namespace', async () => {
    // Make an authenticated read so the limiter records a counter for this
    // principal. (The stack sets REDIS_HOST, so the main limiter uses Redis.)
    const agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    const res = await listTasks({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
    });
    expect(res.response.status).toBe(200);

    // The @fastify/rate-limit RedisStore writes keys prefixed with our
    // nameSpace. If the limiter were still in-memory, none would exist.
    const keys = await redis.keys(`${REDIS_NAMESPACE}*`);
    expect(keys.length).toBeGreaterThan(0);
  });
});
