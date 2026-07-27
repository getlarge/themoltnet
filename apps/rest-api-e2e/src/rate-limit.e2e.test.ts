/**
 * E2E: Rate limiting — the 429 contract end-to-end.
 *
 * Proves against the real Fastify server (real @fastify/rate-limit, real
 * onRequest lifecycle, real RFC 9457 error handler) the things that only a
 * black-box run can verify: that an exhausted bucket returns a 429 with the
 * documented Problem Details body AND the standard rate-limit headers.
 *
 * Target: the three public verification routes, which share one IP-keyed
 * `publicVerify` budget. The e2e stack keeps the real limit high enough for
 * sibling suites; this file seeds its isolated Redis counter immediately below
 * the limit so it can prove cross-route sharing and the 429 contract without
 * poisoning unrelated verification tests.
 *
 * Per-identity isolation and multi-token coalescing are covered by the
 * integration test (rate-limit-keying.test.ts) — they need low per-identity
 * limits that would break sibling e2e suites if applied to the shared stack.
 *
 * The before/after hooks clear the e2e-only Redis namespace so this adversarial
 * test cannot leak state into earlier or later suites.
 */

import {
  createClient,
  createTask,
  listTasks,
  validatePreviewSignChallenge,
  verifyAgentSignature,
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

// Must match RATE_LIMIT_PUBLIC_VERIFY in docker-compose.e2e.yaml. Keep this
// above the full suite's legitimate verification traffic.
const PUBLIC_VERIFY_LIMIT = 10_000;

// An unknown signature: the handler returns 200 { valid: false } without needing
// real crypto, so each call exercises the rate limiter, not the verify logic.
const DUMMY_SIGNATURE = 'a'.repeat(88);
const UNKNOWN_FINGERPRINT = 'AAAA-BBBB-CCCC-DDDD';
const UNKNOWN_REQUEST_ID = '660e8400-e29b-41d4-a716-446655440001';
const UNKNOWN_CHALLENGE = {
  verificationMethod: 'human-hardware-previewsign' as const,
  value: {
    verificationMethod: 'human-hardware-previewsign' as const,
    version: 1 as const,
    envelope: 'ZW52ZWxvcGU',
    digest: 'A'.repeat(43),
    additionalArguments: 'YXJndW1lbnRz',
    outerCredentialId: 'Y3JlZGVudGlhbA',
    outerPublicKey: {
      kty: 2 as const,
      algorithm: -7 as const,
      curve: 1 as const,
      x: 'B'.repeat(43),
      y: 'C'.repeat(43),
    },
    previewKeyHandle: 'aGFuZGxl',
  },
};

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
    await clearE2eRateLimitKeys();
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await clearE2eRateLimitKeys();
    await harness?.teardown();
  });

  it('shares one seeded budget across all public verification routes and returns RFC 9457 on 429', async () => {
    // Create the shared counter through previewSign validation. Its uniform 404
    // still counts, and gives the test the exact Redis key chosen for this
    // Docker client's proxy-aware IP.
    const validation = await validatePreviewSignChallenge({
      client,
      body: {
        version: 1,
        operation: 'signing-request',
        resourceId: UNKNOWN_REQUEST_ID,
        challenge: UNKNOWN_CHALLENGE,
      },
    });
    expect(validation.response.status).toBe(404);

    const redis = new Redis({ host: '127.0.0.1', port: REDIS_HOST_PORT });
    try {
      const keys = await redis.keys(`${REDIS_NAMESPACE}*public-verify`);
      expect(keys).toHaveLength(1);
      const [key] = keys;
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      await redis.set(key, PUBLIC_VERIFY_LIMIT - 1, 'PX', ttl);
    } finally {
      await redis.quit();
    }

    // The legacy crypto route consumes the final token. If validation had a
    // separate child store, this would report limit-1 remaining instead of 0.
    const crypto = await verifyCryptoSignature({
      client,
      body: { signature: DUMMY_SIGNATURE },
    });
    expect(crypto.response.status).toBe(200);
    expect(crypto.response.headers.get('x-ratelimit-remaining')).toBe('0');

    // The agent lookup route must see the same exhausted counter.
    const throttled = await verifyAgentSignature({
      client,
      path: { fingerprint: UNKNOWN_FINGERPRINT },
      body: { signature: DUMMY_SIGNATURE },
    });
    expect(throttled.response.status).toBe(429);
    const throttledBody = throttled.error as Record<string, unknown>;
    const throttledHeaders = throttled.response.headers;

    // RFC 9457 Problem Details body.
    expect(throttledBody).toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      title: 'Rate Limit Exceeded',
    });
    expect(typeof throttledBody.detail).toBe('string');
    expect(throttledBody.retryAfter).toBeTypeOf('number');

    // Standard rate-limit + retry-after headers so clients can back off.
    expect(throttledHeaders.get('retry-after')).toBeTruthy();
    expect(throttledHeaders.get('x-ratelimit-limit')).toBe(
      String(PUBLIC_VERIFY_LIMIT),
    );
    expect(throttledHeaders.get('x-ratelimit-remaining')).toBe('0');
    expect(throttledHeaders.get('x-ratelimit-reset')).toBeTruthy();
  });

  it('never attaches rate limiting to allowlisted paths (/health)', async () => {
    // /health is in RATE_LIMIT_ALLOWLIST, so it bypasses BOTH the pre-resolve
    // throttle and the main limiter. The preceding test leaves the public
    // verification counter exhausted; health must remain available without
    // consuming or reporting any budget.
    const results = await Promise.all(
      Array.from({ length: 3 }, () => fetch(`${harness.baseUrl}/health`)),
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
