/**
 * Integration test for issue #1336 Part 4: a 429 emits a structured warn log
 * (`rate limit exceeded`) carrying the bucket, subject type, method, and route,
 * so rate-limit events are filterable in logs/traces without a dedicated metric.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rateLimitPlugin } from '../src/plugins/rate-limit.js';
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

  it('records and logs a limiter store bypass when Redis returns a callback error', async () => {
    // Arrange
    const sink = captureStream();
    const redis = {
      defineCommand: vi.fn(function (this: { rateLimit?: unknown }) {
        this.rateLimit = (...args: unknown[]) => {
          const callback = args.at(-1) as (error: Error) => void;
          callback(new TypeError('rate-limit store unavailable'));
        };
      }),
    } as unknown as Redis;
    const app = Fastify({ logger: { level: 'error', stream: sink } });
    await app.register(rateLimitPlugin, {
      globalAuthLimit: 10,
      globalAnonLimit: 10,
      tokenIpLimit: 10,
      embeddingLimit: 10,
      signingLimit: 10,
      agentKeyLimit: 10,
      recoveryLimit: 10,
      publicVerifyLimit: 10,
      publicSearchLimit: 10,
      legreffierStartLimit: 10,
      legreffierStatusLimit: 10,
      registrationLimit: 10,
      readinessLimit: 10,
      taskArtifactUploadLimit: 10,
      readLimit: 10,
      allowList: [],
      redis,
    });
    app.get('/check', () => ({ ok: true }));

    try {
      // Act
      const response = await app.inject('/check');

      // Assert
      expect(response.statusCode).toBe(200);
      expect(sink.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'rate-limit Redis store check bypassed',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});
