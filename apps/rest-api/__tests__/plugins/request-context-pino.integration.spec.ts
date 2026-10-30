/**
 * Integration test for request-context ALS propagation through pino.
 *
 * Reproduces the production setup:
 *   - real pino instance with our `getRequestContextFields` mixin
 *   - Fastify with `loggerInstance` (production codepath, not the dev
 *     `logger:` config path)
 *   - real HTTP request via `fastify.listen` + `fetch` (NOT `inject`,
 *     which may preserve async context differently than the real
 *     http server hookup)
 *   - logs emitted from inside the handler via `request.log`
 *
 * Asserts that fields written to ALS in a `preHandler` hook reach
 * pino log records via the mixin — i.e. the bug we observed in
 * production (zero `identityId` on 723 request-completed logs over
 * 2h) cannot recur silently.
 */

import '@moltnet/auth';

import { FastifyOtelInstrumentation } from '@fastify/otel';
import {
  enterRequestContext,
  getRequestContextFields,
  setRequestContextField,
} from '@moltnet/observability';
import Fastify, { type FastifyRequest } from 'fastify';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { requestContextPlugin } from '../../src/plugins/request-context.js';

// Recreate the production wrapping that breaks naive als.run() scope
// continuity: @fastify/otel runs each hook inside `context.with(otelCtx, ...)`.
// Returning the plugin from a helper keeps each test self-contained.
function makeOtelPlugin() {
  const inst = new FastifyOtelInstrumentation({});
  return inst.plugin();
}

/**
 * Test stand-in for the libs/auth `applyAuthContext` helper. Mirrors
 * the same writes (ALS fields + request.log child binding) so these
 * tests don't drag in the full auth plugin chain.
 */
function authStub(
  request: FastifyRequest,
  ctx: {
    identityId: string;
    subjectType: 'agent' | 'human';
    clientId?: string;
    currentTeamId?: string;
  },
): void {
  request.authContext = {
    ...ctx,
    scopes: [],
    publicKey: 'k',
    fingerprint: 'fp',
  } as typeof request.authContext;
  setRequestContextField('identityId', ctx.identityId);
  setRequestContextField('subjectType', ctx.subjectType);
  if (ctx.clientId) setRequestContextField('clientId', ctx.clientId);
  if (ctx.currentTeamId)
    setRequestContextField('currentTeamId', ctx.currentTeamId);
  const bindings: Record<string, string> = {
    identityId: ctx.identityId,
    subjectType: ctx.subjectType,
  };
  if (ctx.clientId) bindings.clientId = ctx.clientId;
  if (ctx.currentTeamId) bindings.currentTeamId = ctx.currentTeamId;
  request.log = request.log.child(bindings);
}

describe('request-context ALS propagation through pino', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it('logs emitted from a route handler carry identityId set in preHandler', async () => {
    const records: Record<string, unknown>[] = [];
    // Custom pino destination that captures every log record so we can
    // assert on its contents. Real production logger has the same mixin.
    const logger = pino(
      {
        level: 'info',
        mixin: getRequestContextFields,
      },
      {
        write(chunk: string) {
          for (const line of chunk.split('\n')) {
            if (!line) continue;
            records.push(JSON.parse(line) as Record<string, unknown>);
          }
        },
      },
    );

    const app = Fastify({ loggerInstance: logger });
    app.decorateRequest('authContext', null);

    await app.register(requestContextPlugin);
    // Auth happens AFTER the global request-context onRequest hook,
    // mirroring the production order (auth is a route/plugin-scoped
    // preHandler).
    app.addHook('preHandler', async (request) => {
      authStub(request, {
        identityId: 'agent-abc',
        subjectType: 'agent',
        clientId: 'client-xyz',
        currentTeamId: 'team-1',
      });
    });

    app.get('/check', async (request) => {
      // Emit a log via the request logger — this is the production
      // path that should pick up identityId via the ALS mixin.
      request.log.info({ marker: 'handler' }, 'inside handler');
      return { ok: true, fields: getRequestContextFields() };
    });

    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    cleanup = () => app.close();

    const res = await fetch(`${url}/check`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Record<string, unknown> };

    // Synchronous-in-handler ALS read still works as a sanity check.
    expect(body.fields.identityId).toBe('agent-abc');
    expect(body.fields.subjectType).toBe('agent');

    // The real assertion: the log emitted via request.log.info inside
    // the handler must carry identityId from ALS via the mixin.
    const handlerLog = records.find((r) => r.marker === 'handler');
    expect(
      handlerLog,
      'expected a log record with marker=handler',
    ).toBeDefined();
    expect(handlerLog!.identityId).toBe('agent-abc');
    expect(handlerLog!.subjectType).toBe('agent');
    expect(handlerLog!.clientId).toBe('client-xyz');
    expect(handlerLog!.currentTeamId).toBe('team-1');
    expect(handlerLog!.requestId).toEqual(expect.any(String));
  });

  it('logs emitted in a deferred async tick still carry context', async () => {
    // Production failure mode: a service-layer `await` that resumes
    // on a microtask scheduled outside the original ALS scope.
    // enterWith() should still propagate to that resumption.
    const records: Record<string, unknown>[] = [];
    const logger = pino(
      { level: 'info', mixin: getRequestContextFields },
      {
        write(chunk: string) {
          for (const line of chunk.split('\n')) {
            if (!line) continue;
            records.push(JSON.parse(line) as Record<string, unknown>);
          }
        },
      },
    );

    const app = Fastify({ loggerInstance: logger });
    app.decorateRequest('authContext', null);
    await app.register(requestContextPlugin);
    app.addHook('preHandler', async (request) => {
      authStub(request, {
        identityId: 'deep-agent',
        subjectType: 'agent',
        clientId: 'c',
        currentTeamId: 't',
      });
    });

    app.get('/deferred', async (request) => {
      // Simulate a service call that awaits a Promise resolved on a
      // future microtask, then logs.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      request.log.info({ marker: 'deferred' }, 'after async hops');
      return { ok: true };
    });

    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    cleanup = () => app.close();

    const res = await fetch(`${url}/deferred`);
    expect(res.status).toBe(200);

    const log = records.find((r) => r.marker === 'deferred');
    expect(log).toBeDefined();
    expect(log!.identityId).toBe('deep-agent');
  });

  it('enriches logs when authContext is set by a route-level preHandler', async () => {
    // PRODUCTION FAILURE MODE.
    //
    // The auth plugin registers `requireAuth` as a route-level preHandler
    // (server.addHook('preHandler', requireAuth) inside taskRoutes).
    // Global preHandlers (e.g. requestContextPlugin's) run BEFORE
    // plugin-scoped preHandlers from child encapsulations. So when the
    // global preHandler tries to read request.authContext, it is still
    // null. The mixin then sees no identityId, and logs ship to axiom
    // without the identity field.
    //
    // The fix: enrichment must happen inside or after the auth plugin's
    // own hook (i.e. once authContext is populated). This test fails
    // until the enrichment moves into the auth plugin.
    const records: Record<string, unknown>[] = [];
    const logger = pino(
      { level: 'info', mixin: getRequestContextFields },
      {
        write(chunk: string) {
          for (const line of chunk.split('\n')) {
            if (!line) continue;
            records.push(JSON.parse(line) as Record<string, unknown>);
          }
        },
      },
    );

    const app = Fastify({ loggerInstance: logger });
    app.decorateRequest('authContext', null);
    await app.register(requestContextPlugin);

    // Reproduce the production layout: a child plugin registers the
    // auth-equivalent preHandler. It runs AFTER the global preHandler
    // from requestContextPlugin. The auth plugin (libs/auth) is the
    // one that writes identity fields into ALS + binds them to
    // request.log; mirror that contract here.
    await app.register(async (instance) => {
      instance.addHook('preHandler', async (request) => {
        const ctx = {
          identityId: 'route-scoped-agent',
          subjectType: 'agent' as const,
          clientId: 'c',
          currentTeamId: 't',
          scopes: [],
          publicKey: 'k',
          fingerprint: 'fp',
        };
        request.authContext = ctx as typeof request.authContext;
        setRequestContextField('identityId', ctx.identityId);
        setRequestContextField('subjectType', ctx.subjectType);
        setRequestContextField('clientId', ctx.clientId);
        setRequestContextField('currentTeamId', ctx.currentTeamId);
        request.log = request.log.child({
          identityId: ctx.identityId,
          subjectType: ctx.subjectType,
          clientId: ctx.clientId,
          currentTeamId: ctx.currentTeamId,
        });
      });

      instance.get('/scoped', async (request) => {
        request.log.info({ marker: 'scoped' }, 'inside scoped handler');
        return { ok: true };
      });
    });

    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    cleanup = () => app.close();

    const res = await fetch(`${url}/scoped`);
    expect(res.status).toBe(200);

    const log = records.find((r) => r.marker === 'scoped');
    expect(log, 'expected handler log').toBeDefined();
    expect(log!.identityId).toBe('route-scoped-agent');
  });

  it('survives @fastify/otel hook wrapping (production codepath)', async () => {
    // Production registers @fastify/otel BEFORE routes; that plugin
    // wraps every hook in `context.with(otelCtx, ...)` which broke
    // continuity of an als.run() scope established in onRequest.
    // enterWith() must remain visible across that wrapping.
    const records: Record<string, unknown>[] = [];
    const logger = pino(
      { level: 'info', mixin: getRequestContextFields },
      {
        write(chunk: string) {
          for (const line of chunk.split('\n')) {
            if (!line) continue;
            records.push(JSON.parse(line) as Record<string, unknown>);
          }
        },
      },
    );

    const app = Fastify({ loggerInstance: logger });
    await app.register(makeOtelPlugin());
    app.decorateRequest('authContext', null);
    await app.register(requestContextPlugin);
    app.addHook('preHandler', async (request) => {
      authStub(request, {
        identityId: 'otel-agent',
        subjectType: 'agent',
        clientId: 'c',
        currentTeamId: 't',
      });
    });

    app.get('/with-otel', async (request) => {
      request.log.info({ marker: 'otel-handler' }, 'hi');
      return { ok: true };
    });

    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    cleanup = () => app.close();

    const res = await fetch(`${url}/with-otel`);
    expect(res.status).toBe(200);

    const log = records.find((r) => r.marker === 'otel-handler');
    expect(log, 'expected handler log under @fastify/otel').toBeDefined();
    expect(log!.identityId).toBe('otel-agent');
  });

  it('setRequestContextField writes from a later hook are visible', async () => {
    // Direct unit-style proof: write in preHandler, read after.
    // This is what setRequestContextField('identityId', ...) does.
    enterRequestContext({ requestId: 'r1' });
    expect(getRequestContextFields()).toEqual({ requestId: 'r1' });

    setRequestContextField('identityId', 'after-the-fact');
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    setRequestContextField('clientId', 'much-later');
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });

    expect(getRequestContextFields()).toEqual({
      requestId: 'r1',
      identityId: 'after-the-fact',
      clientId: 'much-later',
    });
  });
});
