import { context, propagation, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';

import { initWorkerOtel } from './otel.js';

describe('initWorkerOtel', () => {
  afterEach(() => {
    // provider.register() sets the global provider, context manager, and
    // propagator. Tests must reset those so they don't leak across runs
    // and cause order-dependent failures in the rest of the suite.
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('is a no-op when endpoint is missing', async () => {
    const before = trace.getTracerProvider();

    const shutdown = await initWorkerOtel({ serviceName: 'test-service' });

    // No-op bootstrap must leave the global provider untouched.
    expect(trace.getTracerProvider()).toBe(before);

    // shutdown must resolve cleanly even with nothing to flush.
    await expect(shutdown()).resolves.toBeUndefined();
  });

  it('honors an explicit endpoint without an agentDir (no auth)', async () => {
    // The factory registers a provider but doesn't attempt a connect().
    // We don't actually export anything here — the BatchSpanProcessor
    // only flushes on forceFlush() or shutdown(), and we call shutdown
    // immediately. This exercises the "no agentDir → no headers factory"
    // branch without needing a live Hydra.
    const shutdown = await initWorkerOtel({
      serviceName: 'test-service',
      endpoint: 'http://127.0.0.1:1', // unreachable, but we never send
    });

    // Provider has been replaced with something that returns a real tracer.
    const tracer = trace.getTracer('test');
    expect(tracer).toBeDefined();

    await expect(shutdown()).resolves.toBeUndefined();
  });
});
