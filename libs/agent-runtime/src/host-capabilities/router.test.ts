import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { defineHostCapability } from './define.js';
import { createHostCapabilityRouter } from './router.js';

const identity = {
  agentName: 'a',
  identityId: 'id',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: 'F',
  gitName: 'A',
  gitEmail: 'a@x',
};

const echo = defineHostCapability({
  name: 'echo',
  operations: {
    say: {
      request: Type.Object(
        { text: Type.String({ maxLength: 8 }) },
        { additionalProperties: false },
      ),
      response: Type.Object({ text: Type.String() }),
      handle: (input: { text: string }) =>
        Promise.resolve({ text: input.text.toUpperCase() }),
      evidence: (input: { text: string }) => ({ length: input.text.length }),
    },
  },
  guest: {
    env: { ECHO_URL: '${origin}' },
    files: [{ path: '/home/agent/.echo', content: () => 'x' }],
    services: [{ id: 'svc', command: ['echo'] }],
  },
});

type RouterInput = Parameters<typeof createHostCapabilityRouter>[0];

function router(opts: Partial<RouterInput> = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const r = createHostCapabilityRouter({
    capabilities: [echo],
    context: {
      taskId: 't',
      attemptN: 1,
      teamId: 'team',
      agent: {} as never,
      identity,
    },
    injected: {},
    paths: { mountPath: '/work' },
    logger,
    ...opts,
  });
  return { r, logger };
}

const ORIGIN = 'https://echo.moltnet.internal';
const post = (r: ReturnType<typeof router>['r'], path: string, body: unknown) =>
  r.origins[ORIGIN](
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('createHostCapabilityRouter', () => {
  it('exposes origin, manifest and guest projection with ${origin} expanded', () => {
    const { r } = router();
    expect(Object.keys(r.origins)).toEqual([ORIGIN]);
    expect(r.manifest).toEqual([
      {
        name: 'echo',
        origin: ORIGIN,
        operations: ['say'],
        descriptorCid: expect.stringMatching(/^bafkrei/) as unknown as string,
      },
    ]);
    expect(r.guestProjection.env).toEqual({ ECHO_URL: ORIGIN });
    expect(r.guestProjection.files).toEqual([
      { path: '/home/agent/.echo', content: 'x', mode: undefined },
    ]);
    expect(r.guestProjection.services).toEqual([
      { id: 'svc', command: ['echo'] },
    ]);
  });

  it('serves the non-secret identity', async () => {
    const { r } = router();
    const res = await r.origins[ORIGIN](new Request(`${ORIGIN}/identity`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(identity);
  });

  it('fails closed before the policy is installed', async () => {
    const { r, logger } = router();
    const res = await post(r, '/say', { text: 'hi' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'policy_not_ready' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'echo',
        operation: 'say',
        reason: 'policy_not_ready',
      }),
      'host_capability.denied',
    );
  });

  it('validates the request schema', async () => {
    const { r } = router();
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    expect((await post(r, '/say', { text: 'toolongtext' })).status).toBe(400);
    expect((await post(r, '/say', { nope: 1 })).status).toBe(400);
  });

  it('denies without a grant in enforce mode and allows with one', async () => {
    const { r, logger } = router();
    r.setPolicy({ enforcement: 'enforce', allowedTools: new Set() });
    expect((await post(r, '/say', { text: 'hi' })).status).toBe(403);
    r.setPolicy({
      enforcement: 'enforce',
      allowedTools: new Set(['capability:echo:say']),
    });
    const res = await post(r, '/say', { text: 'hi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'HI' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'echo',
        operation: 'say',
        length: 2,
        decision: 'allow',
      }),
      'host_capability.allowed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('"hi"');
  });

  it('audits but allows in watch mode', async () => {
    const { r, logger } = router();
    r.setPolicy({ enforcement: 'watch', allowedTools: new Set() });
    expect((await post(r, '/say', { text: 'hi' })).status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'audit' }),
      'host_capability.audit',
    );
  });

  it('returns 404 for unknown operations and 429 over the rate limit', async () => {
    const { r } = router({ rateLimitPerMinute: 1 });
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    expect((await post(r, '/nope', {})).status).toBe(404);
    expect((await post(r, '/say', { text: 'a' })).status).toBe(200);
    expect((await post(r, '/say', { text: 'b' })).status).toBe(429);
  });

  it('rejects a non-JSON body and a GET on an operation', async () => {
    const { r } = router();
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    const bad = await r.origins[ORIGIN](
      new Request(`${ORIGIN}/say`, { method: 'POST', body: 'not json' }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'invalid_request' });
    const get = await r.origins[ORIGIN](new Request(`${ORIGIN}/say`));
    expect(get.status).toBe(404);
  });

  it('invoke() applies the same gate as HTTP', async () => {
    const { r, logger } = router();
    expect(await r.invoke('echo', 'say', { text: 'hi' })).toMatchObject({
      ok: false,
      status: 503,
      code: 'policy_not_ready',
    });
    r.setPolicy({ enforcement: 'enforce', allowedTools: new Set() });
    expect(await r.invoke('echo', 'say', { text: 'hi' })).toMatchObject({
      ok: false,
      status: 403,
      code: 'host_capability_denied',
    });
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    expect(await r.invoke('echo', 'say', { text: 'hi' })).toEqual({
      ok: true,
      output: { text: 'HI' },
    });
    expect(await r.invoke('echo', 'nope', {})).toMatchObject({ status: 404 });
    expect(
      await r.invoke('echo', 'say', { text: 'way too long' }),
    ).toMatchObject({
      status: 400,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'allow' }),
      'host_capability.allowed',
    );
  });

  it('rejects oversized bodies before parsing them', async () => {
    const { r, logger } = router();
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    const big = JSON.stringify({ text: 'x'.repeat(20_000) });
    const res = await r.origins[ORIGIN](
      new Request(`${ORIGIN}/say`, {
        method: 'POST',
        body: big,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(413);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'body_too_large' }),
      'host_capability.denied',
    );
  });

  it('emits a denial evidence record for a schema-invalid request', async () => {
    const { r, logger } = router();
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    expect(
      await r.invoke('echo', 'say', { text: 'way too long' }),
    ).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_request', decision: 'deny' }),
      'host_capability.denied',
    );
  });

  it('rejects an already-aborted parent before the handler can run', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const handle = vi.fn(() => Promise.resolve({ text: 'HI' }));
    const spy = defineHostCapability({
      name: 'echo',
      operations: {
        say: {
          request: Type.Object(
            { text: Type.String({ maxLength: 8 }) },
            { additionalProperties: false },
          ),
          response: Type.Object({ text: Type.String() }),
          handle,
          evidence: (input: { text: string }) => ({
            length: input.text.length,
          }),
        },
      },
    });
    const controller = new AbortController();
    controller.abort();
    const r = createHostCapabilityRouter({
      capabilities: [spy],
      context: {
        taskId: 't',
        attemptN: 1,
        teamId: 'team',
        agent: {} as never,
        identity,
      },
      injected: {},
      paths: { mountPath: '/work' },
      logger,
      signal: controller.signal,
    });
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    const res = await r.invoke('echo', 'say', { text: 'hi' });
    expect(res).toMatchObject({
      ok: false,
      code: 'operation_cancelled',
      status: 503,
    });
    // The security-critical guarantee: the handler is never scheduled, so no
    // signature/API submission can complete after cancellation is reported.
    await Promise.resolve();
    expect(handle).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'cancel', reason: 'parent_aborted' }),
      'host_capability.cancelled',
    );
  });

  it('bounds concurrent in-flight calls and enforces a deadline', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = defineHostCapability({
      name: 'slow',
      operations: {
        wait: {
          request: Type.Object({}),
          response: Type.Object({}),
          timeoutMs: 50,
          handle: async (_input, ctx) => {
            await Promise.race([
              gate,
              new Promise((_, reject) => {
                ctx.signal.addEventListener('abort', () => {
                  reject(new Error('x'));
                });
              }),
            ]);
            return {};
          },
          evidence: () => ({}),
        },
      },
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const r = createHostCapabilityRouter({
      capabilities: [slow],
      context: {
        taskId: 't',
        attemptN: 1,
        teamId: 'team',
        agent: {} as never,
        identity,
      },
      injected: {},
      paths: { mountPath: '/w' },
      logger,
      maxInFlightPerCapability: 1,
    });
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    const first = r.invoke('slow', 'wait', {});
    expect(await r.invoke('slow', 'wait', {})).toMatchObject({
      status: 429,
      code: 'too_many_in_flight',
    });
    expect(await first).toMatchObject({
      status: 504,
      code: 'operation_timeout',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'deadline' }),
      'host_capability.timeout',
    );
    release();
  });

  it('rejects colliding env, file paths and service ids across capabilities', () => {
    const a = defineHostCapability({
      name: 'alpha',
      operations: {
        op: {
          request: Type.Object({}),
          response: Type.Object({}),
          handle: () => Promise.resolve({}),
          evidence: () => ({}),
        },
      },
      guest: {
        env: { SHARED: '1' },
        files: [{ path: '/home/agent/x', content: () => 'a' }],
        services: [{ id: 'svc', command: ['true'] }],
      },
    });
    const b = defineHostCapability({
      name: 'beta',
      operations: {
        op: {
          request: Type.Object({}),
          response: Type.Object({}),
          handle: () => Promise.resolve({}),
          evidence: () => ({}),
        },
      },
      guest: { env: { SHARED: '2' } },
    });
    const c = defineHostCapability({
      name: 'gamma',
      operations: {
        op: {
          request: Type.Object({}),
          response: Type.Object({}),
          handle: () => Promise.resolve({}),
          evidence: () => ({}),
        },
      },
      guest: { files: [{ path: '/home/agent/./x', content: () => 'c' }] },
    });
    const d = defineHostCapability({
      name: 'delta',
      operations: {
        op: {
          request: Type.Object({}),
          response: Type.Object({}),
          handle: () => Promise.resolve({}),
          evidence: () => ({}),
        },
      },
      guest: { services: [{ id: 'svc', command: ['false'] }] },
    });
    const make = (
      caps: Parameters<typeof createHostCapabilityRouter>[0]['capabilities'],
    ) =>
      createHostCapabilityRouter({
        capabilities: caps,
        context: {
          taskId: 't',
          attemptN: 1,
          teamId: 'team',
          agent: {} as never,
          identity,
        },
        injected: {},
        paths: { mountPath: '/w' },
        logger: { info: vi.fn(), warn: vi.fn() },
      });
    expect(() => make([a, b])).toThrow(/Guest env "SHARED"/);
    expect(() => make([a, c])).toThrow(/Guest file "\/home\/agent\/x"/);
    expect(() => make([a, d])).toThrow(/Guest service "svc"/);
    expect(() => make([a, a])).toThrow(/Duplicate host capability/);
  });

  it('emits denial evidence for unknown operation, wrong method and malformed JSON', async () => {
    const { r, logger } = router();
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });

    // Unknown operation (POST to a path with no spec).
    await post(r, '/nope', {});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'deny',
        reason: 'unknown_operation',
      }),
      'host_capability.denied',
    );

    // Wrong method (GET on a real operation).
    logger.warn.mockClear();
    await r.origins[ORIGIN](new Request(`${ORIGIN}/say`, { method: 'GET' }));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'deny',
        reason: 'method_not_allowed',
      }),
      'host_capability.denied',
    );

    // Malformed JSON body.
    logger.warn.mockClear();
    await r.origins[ORIGIN](
      new Request(`${ORIGIN}/say`, {
        method: 'POST',
        body: 'not json{',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'deny', reason: 'invalid_request' }),
      'host_capability.denied',
    );
  });

  it('redacts handler failures', async () => {
    const boom = defineHostCapability({
      name: 'boom',
      operations: {
        go: {
          request: Type.Object({}),
          response: Type.Object({}),
          handle: () => Promise.reject(new Error('secret-value-123')),
          evidence: () => ({}),
        },
      },
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const r = createHostCapabilityRouter({
      capabilities: [boom],
      context: {
        taskId: 't',
        attemptN: 1,
        teamId: 'team',
        agent: {} as never,
        identity,
      },
      injected: {},
      paths: { mountPath: '/w' },
      logger,
    });
    r.setPolicy({ enforcement: 'off', allowedTools: new Set() });
    const res = await r.origins['https://boom.moltnet.internal'](
      new Request('https://boom.moltnet.internal/go', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret-value-123');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'secret-value-123',
    );
  });
});
