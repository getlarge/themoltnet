import type { DestinationStream } from 'pino';
import pino from 'pino';

export interface CreateLoggerOptions {
  /** Service name included in every log record */
  serviceName: string;
  /** Service version included in every log record */
  serviceVersion?: string;
  /** Deployment environment (e.g. development, production) */
  environment?: string;
  /** Pino log level (default: 'info') */
  level?: string;
  /** Enable pretty printing for development (default: false) */
  pretty?: boolean;
  /** Enable OTel log transport - sends logs through OpenTelemetry pipeline */
  otelEnabled?: boolean;
  /** Custom destination stream (useful for testing) */
  destination?: DestinationStream;
}

/**
 * Create a configured Pino logger instance.
 *
 * When `otelEnabled` is true and no custom destination is provided,
 * logs are sent through `pino-opentelemetry-transport` which bridges
 * them into the OpenTelemetry Logs SDK pipeline.
 *
 * The logger always includes `service`, `version`, and `environment`
 * in the base bindings for consistent structured logging.
 */
export function createLogger(options: CreateLoggerOptions): pino.Logger {
  const {
    serviceName,
    serviceVersion,
    environment,
    level = 'info',
    pretty = false,
    otelEnabled = false,
    destination,
  } = options;

  const base: Record<string, string> = {
    service: serviceName,
  };

  if (serviceVersion) {
    base.version = serviceVersion;
  }

  if (environment) {
    base.environment = environment;
  }

  // When a custom destination is provided (e.g. for testing), use it directly
  if (destination) {
    return pino({ level, base }, destination);
  }

  // Build transport targets
  if (otelEnabled) {
    return pino({
      level,
      base,
      transport: {
        targets: [
          pretty
            ? {
                target: 'pino-pretty',
                options: { colorize: true },
                level,
              }
            : {
                target: 'pino/file',
                options: { destination: 1 },
                level,
              },
          {
            target: 'pino-opentelemetry-transport',
            options: {
              resourceAttributes: {
                'service.name': serviceName,
                'service.version': serviceVersion ?? '',
                'deployment.environment': environment ?? '',
              },
            },
            level,
          },
        ],
      },
    });
  }

  if (pretty) {
    return pino({
      level,
      base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  return pino({ level, base });
}
