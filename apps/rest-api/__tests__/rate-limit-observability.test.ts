/**
 * Integration test for issue #1336 Part 4: a 429 emits a structured warn log
 * (`rate limit exceeded`) carrying the bucket, subject type, method, and route,
 * so rate-limit events are filterable in logs/traces without a dedicated metric.
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

interface LogLine {
  level: number;
  msg: string;
  bucket?: string;
  subjectType?: string;
  method?: string;
  route?: string;
}

/** Collect pino NDJSON lines written to this stream. */
function captureStream(): { lines: LogLine[]; write(s: string): void } {
  const lines: LogLine[] = [];
  return {
    lines,
    write(s: string) {
      for (const part of s.split('\n')) {
        if (part.trim()) lines.push(JSON.parse(part) as LogLine);
      }
    },
  };
}

describe('Rate limiter observability (#1336 part 4)', () => {
  let mocks: MockServices;

  beforeEach(() => {
    mocks = createMockServices();
  });

  it('logs a structured "rate limit exceeded" warn with bucket/subjectType/route on a 429', async () => {
    const sink = captureStream();
    // The read bucket (GET /agents/whoami uses groupId 'read'); limit 1 so the
    // 2nd request is throttled.
    const app: FastifyInstance = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      { rateLimitGlobalRead: 1 },
      undefined,
      undefined,
      { level: 'warn', stream: sink },
    );

    const hit = () =>
      app.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: { authorization: 'Bearer t' },
      });

    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(429);

    const exceeded = sink.lines.find((l) => l.msg === 'rate limit exceeded');
    expect(exceeded).toBeDefined();
    expect(exceeded).toMatchObject({
      bucket: 'read',
      subjectType: 'agent',
      method: 'GET',
      route: '/agents/whoami',
    });

    await app.close();
  });

  it('labels the global bucket and anonymous subject for an unauthenticated 429', async () => {
    const sink = captureStream();
    // POST /tasks is on the global bucket; anon limit 1 → 2nd anon request 429s
    // (rate-limit onRequest runs before requireAuth's 401).
    const app: FastifyInstance = await createTestApp(
      mocks,
      null,
      { rateLimitGlobalAnon: 1 },
      undefined,
      () => null,
      { level: 'warn', stream: sink },
    );

    const hit = () =>
      app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });

    await hit();
    await hit();

    const exceeded = sink.lines.find((l) => l.msg === 'rate limit exceeded');
    expect(exceeded).toBeDefined();
    expect(exceeded).toMatchObject({
      bucket: 'global',
      subjectType: 'anonymous',
      method: 'POST',
      route: '/tasks',
    });

    await app.close();
  });
});
