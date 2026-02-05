export type { ObservabilityPluginOptions } from './fastify-plugin.js';
export { observabilityPlugin } from './fastify-plugin.js';
export type { CreateLoggerOptions } from './logger.js';
export { createLogger, DEFAULT_REDACT_PATHS } from './logger.js';
export type { CreateMeterProviderOptions } from './metrics.js';
export { createMeterProvider, createRequestMetrics } from './metrics.js';
export { initObservability } from './sdk.js';
export type { CreateTraceProviderOptions } from './tracing.js';
export { createTraceProvider } from './tracing.js';
export type {
  LoggerConfig,
  MetricsConfig,
  ObservabilityConfig,
  ObservabilityContext,
  OtlpConfig,
  RequestMetrics,
  TracingConfig,
} from './types.js';
