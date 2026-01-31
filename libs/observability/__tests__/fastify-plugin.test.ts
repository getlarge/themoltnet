import { metrics as metricsApi, trace } from '@opentelemetry/api';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { observabilityPlugin } from '../src/fastify-plugin.js';
import { createMeterProvider } from '../src/metrics.js';
import { TestMetricReader } from './test-metric-reader.js';

describe('observabilityPlugin', () => {
  afterEach(() => {
    metricsApi.disable();
    trace.disable();
  });

  it('should register as a Fastify plugin without error', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });
    await app.ready();
    await app.close();
  });

  it('should decorate the app with shutdown hook', async () => {
    let shutdownCalled = false;
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
      shutdown: async () => {
        shutdownCalled = true;
      },
    });
    await app.ready();
    await app.close();
    expect(shutdownCalled).toBe(true);
  });

  it('should track request duration metrics', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });
    metricsApi.setGlobalMeterProvider(provider);

    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/test', async () => {
      return { ok: true };
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });
    expect(response.statusCode).toBe(200);

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const durationMetric = scopeMetrics?.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.duration',
    );
    expect(durationMetric).toBeDefined();
    if (!durationMetric) throw new Error('expected durationMetric');
    expect(durationMetric.dataPoints.length).toBeGreaterThan(0);

    await app.close();
    await provider.shutdown();
  });

  it('should track total request count', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });
    metricsApi.setGlobalMeterProvider(provider);

    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/count', async () => {
      return { ok: true };
    });

    await app.ready();

    // Make 3 requests
    await app.inject({ method: 'GET', url: '/count' });
    await app.inject({ method: 'GET', url: '/count' });
    await app.inject({ method: 'GET', url: '/count' });

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const totalMetric = scopeMetrics?.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.total',
    );
    expect(totalMetric).toBeDefined();
    if (!totalMetric) throw new Error('expected totalMetric');

    const dataPoint = totalMetric.dataPoints[0];
    expect(dataPoint.value).toBe(3);

    await app.close();
    await provider.shutdown();
  });

  it('should track active requests', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });
    metricsApi.setGlobalMeterProvider(provider);

    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/slow', async () => {
      // Simulate active request
      return { ok: true };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/slow' });

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const activeMetric = scopeMetrics?.metrics.find(
      (m) => m.descriptor.name === 'http.server.active_requests',
    );
    expect(activeMetric).toBeDefined();
    if (!activeMetric) throw new Error('expected activeMetric');

    // After request completes, active should be 0
    const dataPoint = activeMetric.dataPoints[0];
    expect(dataPoint.value).toBe(0);

    await app.close();
    await provider.shutdown();
  });

  it('should include HTTP attributes on metrics', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });
    metricsApi.setGlobalMeterProvider(provider);

    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/api/diary', async () => {
      return { entries: [] };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/api/diary' });

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const totalMetric = scopeMetrics?.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.total',
    );

    if (!totalMetric) throw new Error('expected totalMetric');
    const dataPoint = totalMetric.dataPoints[0];
    expect(dataPoint.attributes['http.method']).toBe('GET');
    expect(dataPoint.attributes['http.route']).toBe('/api/diary');
    expect(dataPoint.attributes['http.status_code']).toBe(200);

    await app.close();
    await provider.shutdown();
  });

  it('should record error status codes in metrics', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });
    metricsApi.setGlobalMeterProvider(provider);

    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/error', async (_req, reply) => {
      reply.status(500);
      return { error: 'internal' };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/error' });

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const totalMetric = scopeMetrics?.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.total',
    );

    if (!totalMetric) throw new Error('expected totalMetric');
    const dataPoint = totalMetric.dataPoints[0];
    expect(dataPoint.attributes['http.status_code']).toBe(500);

    await app.close();
    await provider.shutdown();
  });

  it('should work without explicit shutdown function', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'test',
    });

    app.get('/', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);

    // Should close without errors even without shutdown
    await app.close();
  });
});
