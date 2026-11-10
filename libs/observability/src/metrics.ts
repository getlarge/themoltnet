import { metrics as metricsApi } from '@opentelemetry/api';
import {
  type Resource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { MeterProvider, type MetricReader } from '@opentelemetry/sdk-metrics';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { SERVICE_INSTANCE_ID } from './service-instance.js';
import type { RequestMetrics } from './types.js';

export { SERVICE_INSTANCE_ID } from './service-instance.js';

/**
 * `http.server.request.duration` bucket boundaries in milliseconds. The OTel
 * defaults jump from 2500 to 5000, so one 2.6 s request interpolates to a
 * 4875 ms p95. Keep the latency alert threshold (3000 ms) on a boundary: an
 * interpolated quantile then reaches it only if a request exceeded it.
 */
export const HTTP_REQUEST_DURATION_BOUNDARIES_MS = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000,
  5000, 7500, 10000, 15000, 30000,
];

export type MetricAttributes = Record<string, boolean | number | string>;

export interface MetricCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

export interface MetricUpDownCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

export interface MetricHistogram {
  record(value: number, attributes?: MetricAttributes): void;
}

export interface CreateMeterProviderOptions {
  /** Service name for resource identification */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Deployment environment */
  environment?: string;
  /** Metric reader (e.g. PeriodicExportingMetricReader or TestMetricReader) */
  reader?: MetricReader;
}

/**
 * Create a configured MeterProvider.
 *
 * For production, provide a PeriodicExportingMetricReader with an
 * OTLP exporter. For testing, use TestMetricReader.
 *
 * The provider is NOT automatically registered as global - callers
 * should do `metrics.setGlobalMeterProvider(provider)` if desired.
 */
export function createMeterProvider(
  options: CreateMeterProviderOptions,
): MeterProvider {
  const { serviceName, serviceVersion, environment, reader } = options;

  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
    'service.instance.id': SERVICE_INSTANCE_ID,
  };

  if (serviceVersion) {
    resourceAttributes[ATTR_SERVICE_VERSION] = serviceVersion;
  }

  if (environment) {
    resourceAttributes['deployment.environment'] = environment;
  }

  const resource = resourceFromAttributes(resourceAttributes);

  const providerOptions: { resource: Resource; readers?: MetricReader[] } = {
    resource,
  };

  if (reader) {
    providerOptions.readers = [reader];
  }

  return new MeterProvider(providerOptions);
}

/**
 * Create standard HTTP request metrics instruments.
 *
 * Returns a `RequestMetrics` object with:
 * - `duration`: Histogram tracking request latency in milliseconds
 * - `total`: Counter tracking total requests (by method/route/status)
 * - `active`: UpDownCounter tracking concurrently active requests
 *
 * These instruments use the global MeterProvider, so ensure it's
 * set before calling this function.
 */
export function createRequestMetrics(serviceName: string): RequestMetrics {
  const meter = metricsApi.getMeter(serviceName);

  const duration = meter.createHistogram('http.server.request.duration', {
    description: 'Duration of inbound HTTP requests in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: HTTP_REQUEST_DURATION_BOUNDARIES_MS },
  });

  const total = meter.createCounter('http.server.request.total', {
    description: 'Total number of inbound HTTP requests',
  });

  const active = meter.createUpDownCounter('http.server.active_requests', {
    description: 'Number of currently active inbound HTTP requests',
  });

  return { duration, total, active };
}

export function createMetricCounter(
  serviceName: string,
  name: string,
  description: string,
): MetricCounter {
  return metricsApi.getMeter(serviceName).createCounter(name, { description });
}

export function createMetricUpDownCounter(
  serviceName: string,
  name: string,
  description: string,
): MetricUpDownCounter {
  return metricsApi
    .getMeter(serviceName)
    .createUpDownCounter(name, { description });
}

export function createMetricHistogram(
  serviceName: string,
  name: string,
  description: string,
  unit?: string,
): MetricHistogram {
  return metricsApi
    .getMeter(serviceName)
    .createHistogram(name, { description, ...(unit ? { unit } : {}) });
}
