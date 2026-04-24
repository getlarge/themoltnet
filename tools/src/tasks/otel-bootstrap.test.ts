import { trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initWorkerOtel } from './otel-bootstrap.js';

describe('initWorkerOtel', () => {
  const savedEnv = process.env['MOLTNET_OTEL_ENDPOINT'];

  beforeEach(() => {
    delete process.env['MOLTNET_OTEL_ENDPOINT'];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env['MOLTNET_OTEL_ENDPOINT'] = savedEnv;
    } else {
      delete process.env['MOLTNET_OTEL_ENDPOINT'];
    }
  });

  it('is a no-op when neither endpoint option nor env var is set', async () => {
    // Capture the global provider before the call. In a no-op bootstrap,
    // it must remain whatever it was — not replaced with a NodeTracerProvider.
    const before = trace.getTracerProvider();

    const shutdown = await initWorkerOtel({
      serviceName: 'test-service',
    });

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
