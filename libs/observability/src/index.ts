export { createLogger } from './logger.js';
export type { CreateLoggerOptions } from './logger.js';

export { createTraceProvider } from './tracing.js';
export type { CreateTraceProviderOptions } from './tracing.js';

export { createMeterProvider, createRequestMetrics } from './metrics.js';
export type { CreateMeterProviderOptions } from './metrics.js';

export { initObservability } from './sdk.js';

export { observabilityPlugin } from './fastify-plugin.js';
export type { ObservabilityPluginOptions } from './fastify-plugin.js';

export type {
  ObservabilityConfig,
  ObservabilityContext,
  RequestMetrics,
  OtlpConfig,
  LoggerConfig,
  TracingConfig,
  MetricsConfig,
} from './types.js';
