import { FastifyOtelInstrumentation } from '@fastify/otel';
import { metrics as metricsApi } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import type { LogRecordProcessorOptions } from './logger.js';
import { createLogger } from './logger.js';
import { createMeterProvider } from './metrics.js';
import { createTraceProvider } from './tracing.js';
import type { ObservabilityConfig, ObservabilityContext } from './types.js';

/**
 * Initialize the full observability stack.
 *
 * Sets up:
 * 1. Pino logger with structured base bindings + pino-opentelemetry-transport
 *    (two worker threads: stdout and OTLP log export)
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
 *   otlp: { endpoint: 'https://api.axiom.co', headers: { Authorization: 'Bearer ...' } },
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
  config: ObservabilityConfig,
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
      exporter: otlp
        ? new OTLPTraceExporter({
            url: `${otlp.endpoint}/v1/traces`,
            headers: otlp.headers,
          })
        : undefined,
    });

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
            // Use metricsHeaders when provided (separate Axiom dataset for metrics)
            headers: otlp.metricsHeaders ?? otlp.headers,
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

  // Build logRecordProcessorOptions for pino-opentelemetry-transport.
  // The transport runs in a worker thread and manages its own OTLP log exporter.
  // Without this, logs are emitted into the transport but never exported.
  const otelEnabled =
    Boolean(tracingConfig?.enabled || metricsConfig?.enabled) && Boolean(otlp);

  let logRecordProcessorOptions: LogRecordProcessorOptions[] | undefined;
  if (otelEnabled && otlp) {
    logRecordProcessorOptions = [
      {
        recordProcessorType: 'batch',
        exporterOptions: {
          protocol: 'http/protobuf',
          protobufExporterOptions: {
            url: `${otlp.endpoint}/v1/logs`,
            headers: otlp.headers ?? {},
          },
        },
      },
    ];
  }

  const logger = createLogger({
    serviceName,
    serviceVersion,
    environment,
    level: loggerConfig?.level,
    pretty: loggerConfig?.pretty,
    otelEnabled,
    logRecordProcessorOptions,
  });

  const shutdown = async (): Promise<void> => {
    if (hasShutdown) return;
    hasShutdown = true;

    const shutdownPromises: Promise<void>[] = [];

    if (tracerProvider) {
      shutdownPromises.push(
        tracerProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down tracer provider');
        }),
      );
    }

    if (meterProvider) {
      shutdownPromises.push(
        meterProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down meter provider');
        }),
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
