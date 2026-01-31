import { metrics as metricsApi, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';

import { initObservability } from '../src/sdk.js';

describe('initObservability', () => {
  afterEach(async () => {
    trace.disable();
    metricsApi.disable();
  });

  it('should return a logger and shutdown function', () => {
    const ctx = initObservability({
      serviceName: 'test-service',
    });

    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.logger.info).toBe('function');
    expect(typeof ctx.shutdown).toBe('function');
  });

  it('should create a logger with the configured service name', () => {
    const ctx = initObservability({
      serviceName: 'moltnet-api',
      serviceVersion: '0.1.0',
    });

    // Pino loggers expose bindings
    const bindings = ctx.logger.bindings();
    expect(bindings.service).toBe('moltnet-api');
    expect(bindings.version).toBe('0.1.0');
  });

  it('should respect logger level configuration', () => {
    const ctx = initObservability({
      serviceName: 'test',
      logger: { level: 'error' },
    });

    expect(ctx.logger.level).toBe('error');
  });

  it('should initialize tracing when enabled', async () => {
    const ctx = initObservability({
      serviceName: 'test',
      tracing: { enabled: true },
    });

    // Global tracer provider should be set
    const tracer = trace.getTracer('test');
    expect(tracer).toBeDefined();

    await ctx.shutdown();
  });

  it('should initialize metrics when enabled', async () => {
    const ctx = initObservability({
      serviceName: 'test',
      metrics: { enabled: true },
    });

    // Global meter provider should be set
    const meter = metricsApi.getMeter('test');
    expect(meter).toBeDefined();

    await ctx.shutdown();
  });

  it('should not initialize tracing when disabled', () => {
    // Record the provider before init
    const providerBefore = trace.getTracerProvider();

    initObservability({
      serviceName: 'test',
      tracing: { enabled: false },
    });

    // Provider should remain unchanged (ProxyTracerProvider)
    const providerAfter = trace.getTracerProvider();
    expect(providerAfter).toBe(providerBefore);
  });

  it('should not initialize metrics when disabled', () => {
    const providerBefore = metricsApi.getMeterProvider();

    initObservability({
      serviceName: 'test',
      metrics: { enabled: false },
    });

    const providerAfter = metricsApi.getMeterProvider();
    expect(providerAfter).toBe(providerBefore);
  });

  it('should shutdown all providers gracefully', async () => {
    const ctx = initObservability({
      serviceName: 'test',
      tracing: { enabled: true },
      metrics: { enabled: true },
    });

    // Should not throw
    await ctx.shutdown();
  });

  it('should handle multiple shutdown calls without error', async () => {
    const ctx = initObservability({
      serviceName: 'test',
      tracing: { enabled: true },
    });

    await ctx.shutdown();
    // Second shutdown should not throw
    await ctx.shutdown();
  });

  it('should default tracing and metrics to disabled without explicit config', () => {
    const providerBefore = trace.getTracerProvider();

    initObservability({
      serviceName: 'test',
    });

    // Without explicit enabled, providers stay default
    const providerAfter = trace.getTracerProvider();
    expect(providerAfter).toBe(providerBefore);
  });

  it('should return fastifyOtelPlugin when tracing is enabled', async () => {
    const ctx = initObservability({
      serviceName: 'test',
      tracing: { enabled: true },
    });

    expect(ctx.fastifyOtelPlugin).toBeDefined();
    expect(typeof ctx.fastifyOtelPlugin).toBe('function');

    await ctx.shutdown();
  });

  it('should not return fastifyOtelPlugin when tracing is disabled', () => {
    const ctx = initObservability({
      serviceName: 'test',
    });

    expect(ctx.fastifyOtelPlugin).toBeUndefined();
  });
});
