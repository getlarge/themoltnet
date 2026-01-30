import type { Counter, Histogram, UpDownCounter } from '@opentelemetry/api';

export interface OtlpConfig {
  /** OTLP endpoint URL (e.g. http://localhost:4318 for collector, or direct Axiom) */
  endpoint: string;
  /** Additional headers for OTLP export (e.g. Authorization for Axiom) */
  headers?: Record<string, string>;
}

export interface LoggerConfig {
  /** Pino log level */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  /** Enable pretty printing (development only) */
  pretty?: boolean;
}

export interface TracingConfig {
  /** Enable distributed tracing */
  enabled?: boolean;
}

export interface MetricsConfig {
  /** Enable metrics collection */
  enabled?: boolean;
  /** Export interval in milliseconds (default: 60000) */
  exportIntervalMs?: number;
}

export interface ObservabilityConfig {
  /** Service name for resource identification */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Deployment environment (e.g. development, staging, production) */
  environment?: string;
  /** OTLP exporter configuration */
  otlp?: OtlpConfig;
  /** Logger configuration */
  logger?: LoggerConfig;
  /** Tracing configuration */
  tracing?: TracingConfig;
  /** Metrics configuration */
  metrics?: MetricsConfig;
}

export interface RequestMetrics {
  /** Histogram tracking HTTP request duration in milliseconds */
  duration: Histogram;
  /** Counter tracking total HTTP requests */
  total: Counter;
  /** UpDownCounter tracking currently active HTTP requests */
  active: UpDownCounter;
}

export interface ObservabilityContext {
  /** Configured Pino logger instance */
  logger: import('pino').Logger;
  /** Gracefully shutdown all telemetry pipelines */
  shutdown: () => Promise<void>;
}
