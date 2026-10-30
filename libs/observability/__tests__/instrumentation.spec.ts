/**
 * Tests for OTel auto-instrumentation wiring (`initInstrumentation`).
 *
 * Two layers of guarantee:
 *
 *   1. BEHAVIORAL (undici): with a registered provider, an outbound `fetch`
 *      inside an active span carries a W3C `traceparent` header. This is the
 *      mechanism that links a daemon trace to the rest-api server span, and it
 *      is fully exercisable here because UndiciInstrumentation patches via
 *      `diagnostics_channel` at enable() — no module-load hook required.
 *
 *   2. WIRING (pino + config): assert which instrumentations were registered.
 *      PinoInstrumentation injects `trace_id`/`span_id` into log RECORDS via an
 *      `import-in-the-middle` module-load hook. That hook is NOT active under
 *      vitest's module loader (it needs Node's `--import` IITM registration),
 *      so record-level injection cannot be asserted in a vitest unit test —
 *      attempting it tests the harness, not the feature. Record injection is
 *      verified in production / e2e (real Node loader). Here we assert the
 *      PinoInstrumentation is enabled, which catches the regression that
 *      matters: someone disabling pino correlation or dropping the dependency.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { context, propagation, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initInstrumentation } from '../src/instrumentation.js';

describe('initInstrumentation', () => {
  const exporter = new InMemorySpanExporter();
  let provider: NodeTracerProvider;
  let server: Server;
  let baseUrl: string;
  let lastTraceparent: string | undefined;

  beforeAll(async () => {
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // register() installs the global provider + context manager + propagator,
    // matching what initWorkerOtel does in production.
    provider.register();

    server = createServer((req, res) => {
      lastTraceparent = req.headers['traceparent'] as string | undefined;
      res.end('ok');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    exporter.reset();
    lastTraceparent = undefined;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('injects a W3C traceparent on outbound fetch within an active span', async () => {
    initInstrumentation({
      http: true,
      dns: false,
      net: false,
      pino: false,
      pg: false,
    });

    const tracer = trace.getTracer('test');
    await tracer.startActiveSpan('outbound', async (span) => {
      await fetch(baseUrl);
      span.end();
    });

    expect(lastTraceparent).toBeDefined();
    expect(lastTraceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });

  it('registers pino correlation when pino:true', () => {
    const instrumentations = initInstrumentation({
      http: false,
      dns: false,
      net: false,
      pg: false,
      pino: true,
    });

    const names = instrumentations.map((i) => i.instrumentationName);
    expect(names).toContain('@opentelemetry/instrumentation-pino');
  });

  it('omits pg instrumentation when pg:false (daemon has no direct DB)', () => {
    const instrumentations = initInstrumentation({
      http: true,
      dns: true,
      net: true,
      pino: true,
      pg: false,
    });

    const names = instrumentations.map((i) => i.instrumentationName);
    expect(names).not.toContain('@opentelemetry/instrumentation-pg');
    // The undici + pino correlation the daemon relies on are present.
    expect(names).toContain('@opentelemetry/instrumentation-undici');
    expect(names).toContain('@opentelemetry/instrumentation-pino');
  });
});
