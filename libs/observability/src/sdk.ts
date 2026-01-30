import { trace, metrics as metricsApi } from '@opentelemetry/api';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import FastifyOtelInstrumentation from '@fastify/otel';
import { createLogger } from './logger.js';
import { createTraceProvider } from './tracing.js';
import { createMeterProvider } from './metrics.js';
import type { ObservabilityConfig, ObservabilityContext } from './types.js';
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';

/**
 * Initialize the full observability stack.
 *
 * Sets up:
 * 1. Pino logger with structured base bindings
 * 2. OpenTelemetry tracing with @fastify/otel for lifecycle-hook instrumentation
 * 3. OpenTelemetry metrics with OTLP export
 * 4. Graceful shutdown
 *
 * Usage:
 * ```ts
 * const obs = initObservability({
 *   serviceName: 'moltnet-api',
 *   serviceVersion: '0.1.0',
 *   environment: 'production',
 *   otlp: { endpoint: 'http://localhost:4318' },
 *   tracing: { enabled: true },
 *   metrics: { enabled: true },
 * });
 *
 * const app = Fastify({ loggerInstance: obs.logger });
 *
 * // Register @fastify/otel BEFORE routes for full lifecycle tracing
 * if (obs.fastifyOtelPlugin) {
 *   await app.register(obs.fastifyOtelPlugin);
 * }
 *
 * // Register metrics plugin for request duration/count/active
 * await app.register(observabilityPlugin, {
 *   serviceName: 'moltnet-api',
 *   shutdown: obs.shutdown,
 * });
 * ```
 */
export function initObservability(
  config: ObservabilityConfig
): ObservabilityContext {
  const {
    serviceName,
    serviceVersion,
    environment,
    otlp,
    logger: loggerConfig,
    tracing: tracingConfig,
    metrics: metricsConfig,
  } = config;

  let tracerProvider: NodeTracerProvider | undefined;
  let meterProvider: MeterProvider | undefined;
  let fastifyInstrumentation: FastifyOtelInstrumentation | undefined;
  let hasShutdown = false;

  // Initialize tracing if enabled
  if (tracingConfig?.enabled) {
    tracerProvider = createTraceProvider({
      serviceName,
      serviceVersion,
      environment,
    });

    if (otlp) {
      const exporter = new OTLPTraceExporter({
        url: `${otlp.endpoint}/v1/traces`,
        headers: otlp.headers,
      });
      tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter));
    }

    tracerProvider.register();

    // Create @fastify/otel instrumentation for lifecycle-hook tracing
    fastifyInstrumentation = new FastifyOtelInstrumentation({
      ignorePaths: tracingConfig.ignorePaths,
    });
    fastifyInstrumentation.setTracerProvider(tracerProvider);
  }

  // Initialize metrics if enabled
  if (metricsConfig?.enabled) {
    const reader = otlp
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${otlp.endpoint}/v1/metrics`,
            headers: otlp.headers,
          }),
          exportIntervalMillis: metricsConfig.exportIntervalMs ?? 60_000,
        })
      : undefined;

    meterProvider = createMeterProvider({
      serviceName,
      serviceVersion,
      environment,
      reader,
    });

    metricsApi.setGlobalMeterProvider(meterProvider);
  }

  // Create the logger (always, even without OTel)
  const otelEnabled =
    Boolean(tracingConfig?.enabled || metricsConfig?.enabled) && Boolean(otlp);

  const logger = createLogger({
    serviceName,
    serviceVersion,
    environment,
    level: loggerConfig?.level,
    pretty: loggerConfig?.pretty,
    otelEnabled,
  });

  const shutdown = async (): Promise<void> => {
    if (hasShutdown) return;
    hasShutdown = true;

    const shutdownPromises: Promise<void>[] = [];

    if (tracerProvider) {
      shutdownPromises.push(
        tracerProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down tracer provider');
        })
      );
    }

    if (meterProvider) {
      shutdownPromises.push(
        meterProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down meter provider');
        })
      );
    }

    await Promise.all(shutdownPromises);
  };

  return {
    logger,
    shutdown,
    fastifyOtelPlugin: fastifyInstrumentation?.plugin(),
  };
}
