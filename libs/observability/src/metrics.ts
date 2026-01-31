import { metrics as metricsApi } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  MeterProvider,
  type MetricReader,
} from '@opentelemetry/sdk-metrics';
import type { RequestMetrics } from './types.js';

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
  options: CreateMeterProviderOptions
): MeterProvider {
  const { serviceName, serviceVersion, environment, reader } = options;

  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
  };

  if (serviceVersion) {
    resourceAttributes[ATTR_SERVICE_VERSION] = serviceVersion;
  }

  if (environment) {
    resourceAttributes['deployment.environment'] = environment;
  }

  const resource = new Resource(resourceAttributes);

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
  });

  const total = meter.createCounter('http.server.request.total', {
    description: 'Total number of inbound HTTP requests',
  });

  const active = meter.createUpDownCounter('http.server.active_requests', {
    description: 'Number of currently active inbound HTTP requests',
  });

  return { duration, total, active };
}
