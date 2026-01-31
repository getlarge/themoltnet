import { metrics as metricsApi } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';

import { createMeterProvider, createRequestMetrics } from '../src/metrics.js';
import { TestMetricReader } from './test-metric-reader.js';

describe('createMeterProvider', () => {
  afterEach(() => {
    metricsApi.disable();
  });

  it('should create a meter provider with the correct service resource', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'moltnet-api',
      serviceVersion: '0.1.0',
      reader,
    });

    expect(provider).toBeDefined();

    // Create a counter to trigger metric collection with resource
    metricsApi.setGlobalMeterProvider(provider);
    const meter = metricsApi.getMeter('test');
    meter.createCounter('probe').add(1);

    const { resourceMetrics } = await reader.collect();
    expect(resourceMetrics.resource.attributes['service.name']).toBe(
      'moltnet-api',
    );
    expect(resourceMetrics.resource.attributes['service.version']).toBe(
      '0.1.0',
    );

    await provider.shutdown();
  });

  it('should include environment in resource attributes', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      environment: 'production',
      reader,
    });

    expect(provider).toBeDefined();
    await provider.shutdown();
  });
});

describe('createRequestMetrics', () => {
  afterEach(() => {
    metricsApi.disable();
  });

  it('should create duration histogram, total counter, and active gauge', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });

    metricsApi.setGlobalMeterProvider(provider);

    const requestMetrics = createRequestMetrics('test');

    expect(requestMetrics.duration).toBeDefined();
    expect(requestMetrics.total).toBeDefined();
    expect(requestMetrics.active).toBeDefined();

    await provider.shutdown();
  });

  it('should record request duration metrics', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });

    metricsApi.setGlobalMeterProvider(provider);

    const requestMetrics = createRequestMetrics('test');

    const attributes = {
      'http.method': 'GET',
      'http.route': '/api/diary',
      'http.status_code': 200,
    };

    requestMetrics.duration.record(42.5, attributes);
    requestMetrics.total.add(1, attributes);

    const { resourceMetrics } = await reader.collect();
    expect(resourceMetrics.scopeMetrics.length).toBeGreaterThan(0);

    const scopeMetrics = resourceMetrics.scopeMetrics[0];
    expect(scopeMetrics.metrics.length).toBeGreaterThanOrEqual(2);

    const durationMetric = scopeMetrics.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.duration',
    );
    expect(durationMetric).toBeDefined();
    expect(durationMetric!.descriptor.unit).toBe('ms');

    const totalMetric = scopeMetrics.metrics.find(
      (m) => m.descriptor.name === 'http.server.request.total',
    );
    expect(totalMetric).toBeDefined();

    await provider.shutdown();
  });

  it('should track active requests with up-down counter', async () => {
    const reader = new TestMetricReader();
    const provider = createMeterProvider({
      serviceName: 'test',
      reader,
    });

    metricsApi.setGlobalMeterProvider(provider);

    const requestMetrics = createRequestMetrics('test');

    // Simulate 3 requests starting, 1 finishing
    requestMetrics.active.add(1);
    requestMetrics.active.add(1);
    requestMetrics.active.add(1);
    requestMetrics.active.add(-1);

    const { resourceMetrics } = await reader.collect();
    const scopeMetrics = resourceMetrics.scopeMetrics[0];

    const activeMetric = scopeMetrics.metrics.find(
      (m) => m.descriptor.name === 'http.server.active_requests',
    );
    expect(activeMetric).toBeDefined();

    // The sum should be 2 (3 added - 1 removed)
    const dataPoint = activeMetric!.dataPoints[0];
    expect(dataPoint.value).toBe(2);

    await provider.shutdown();
  });
});
