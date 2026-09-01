import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNavigationRequest,
  isLoopbackViolation,
  type LoopbackSecurityOptions,
  type LoopbackViolationError,
  registerLoopbackSecurity,
  rejectExplicitCrossSite,
  requireLoopbackHost,
} from '../src/index.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';

async function buildApp(
  security: LoopbackSecurityOptions = {
    allowedOrigins: [CONSOLE_ORIGIN],
    selfOrigins: ['http://127.0.0.1:17373'],
    allowedHeaders: ['x-test-session'],
  },
): Promise<FastifyInstance> {
  const app = Fastify();
  registerLoopbackSecurity(app, security);
  app.setErrorHandler(async (error, _request, reply) => {
    if (isLoopbackViolation(error)) {
      const status = error.kind === 'origin_not_allowed' ? 403 : 400;
      return reply.code(status).send({ code: error.kind });
    }
    return reply.code(500).send({ code: 'internal' });
  });
  app.get('/probe', async () => ({ ok: true }));
  app.post('/accept-json', async () => ({ ok: true }));
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('registerLoopbackSecurity', () => {
  it('accepts loopback Host headers and marks responses no-store', async () => {
    app = await buildApp();
    for (const host of ['127.0.0.1:7777', 'localhost:7777', '[::1]:7777']) {
      const response = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { host },
      });
      expect(response.statusCode, host).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects non-loopback and missing Host headers', async () => {
    app = await buildApp();
    const rebound = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { host: 'evil.example:7777' },
    });
    expect(rebound.statusCode).toBe(400);
    expect(rebound.json()).toEqual({ code: 'host_not_loopback' });

    // Fastify inject always fills in a Host header, so the missing-host
    // branch is exercised directly.
    try {
      requireLoopbackHost({ headers: {} } as never);
      expect.unreachable();
    } catch (error) {
      expect((error as LoopbackViolationError).kind).toBe('host_required');
    }
  });

  it('grants CORS only to allowlisted and self origins', async () => {
    app = await buildApp();
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        origin: CONSOLE_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-test-session',
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(CONSOLE_ORIGIN);
    expect(
      allowed.headers['access-control-allow-headers']
        ?.split(',')
        .map((header) => header.trim())
        .sort(),
    ).toEqual(['content-type', 'x-test-session']);

    const self = await app.inject({
      method: 'OPTIONS',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        origin: 'http://127.0.0.1:17373',
        'access-control-request-method': 'POST',
      },
    });
    expect(self.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:17373',
    );

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: 'origin_not_allowed' });
  });

  it('composes self origins with a custom origin authority', async () => {
    app = await buildApp({
      isOriginAllowed: (origin) => origin === CONSOLE_ORIGIN,
      selfOrigins: ['http://127.0.0.1:17373'],
    });

    for (const origin of [CONSOLE_ORIGIN, 'http://127.0.0.1:17373']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/accept-json',
        headers: {
          host: '127.0.0.1:7777',
          origin,
          'access-control-request-method': 'POST',
        },
      });
      expect(response.statusCode, origin).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('does not downgrade origin authority failures to denials', async () => {
    app = await buildApp({
      isOriginAllowed: () => {
        throw new Error('origin authority unavailable');
      },
    });

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        origin: CONSOLE_ORIGIN,
        'access-control-request-method': 'POST',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'internal' });
  });

  it('leaves null/absent origins without CORS grants but serves the route', async () => {
    app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { host: '127.0.0.1:7777', origin: 'null' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('parses valid JSON and rejects malformed or non-UTF-8 bodies', async () => {
    app = await buildApp();
    const ok = await app.inject({
      method: 'POST',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ value: 42 }),
    });
    expect(ok.json()).toEqual({ ok: true });

    const malformed = await app.inject({
      method: 'POST',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        'content-type': 'application/json',
      },
      payload: '{"value":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ code: 'body_not_utf8_json' });

    const invalidUtf8 = await app.inject({
      method: 'POST',
      url: '/accept-json',
      headers: {
        host: '127.0.0.1:7777',
        'content-type': 'application/json',
      },
      payload: Buffer.from([0x22, 0xff, 0xfe, 0x22]),
    });
    expect(invalidUtf8.statusCode).toBe(400);
  });

  it('applies the hardened helmet response headers', async () => {
    app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { host: '127.0.0.1:7777' },
    });
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'same-origin',
    );
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('fetch metadata guards', () => {
  it('assertNavigationRequest requires a document navigation', () => {
    for (const site of ['cross-site', 'same-origin', 'none']) {
      expect(() =>
        assertNavigationRequest({
          'sec-fetch-site': site,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        }),
      ).not.toThrow();
    }
    for (const headers of [
      {},
      {
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
      {
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'document',
      },
      {
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'iframe',
      },
    ]) {
      try {
        assertNavigationRequest(headers);
        expect.unreachable();
      } catch (error) {
        expect((error as LoopbackViolationError).kind).toBe(
          'navigation_required',
        );
      }
    }
  });

  it('rejectExplicitCrossSite only rejects the explicit signal', () => {
    expect(() => rejectExplicitCrossSite({})).not.toThrow();
    expect(() =>
      rejectExplicitCrossSite({ 'sec-fetch-site': 'same-origin' }),
    ).not.toThrow();
    try {
      rejectExplicitCrossSite({ 'sec-fetch-site': 'cross-site' });
      expect.unreachable();
    } catch (error) {
      expect((error as LoopbackViolationError).kind).toBe(
        'cross_site_rejected',
      );
    }
  });
});
