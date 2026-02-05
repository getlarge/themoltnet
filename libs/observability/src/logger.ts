import type { DestinationStream, LoggerOptions } from 'pino';
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
  /** Disable redaction (useful for testing) */
  disableRedaction?: boolean;
}

/**
 * Default paths to redact from log output.
 * These cover common locations where sensitive data may appear.
 */
export const DEFAULT_REDACT_PATHS = [
  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-ory-api-key"]',
  'req.headers["x-access-token"]',
  'req.headers["x-refresh-token"]',
  // Response headers (if logged)
  'res.headers["set-cookie"]',
  // Common body fields
  'body.password',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
  'body.apiKey',
  'body.secret',
  'body.privateKey',
  'body.recoveryCodes',
  // Nested request body
  'req.body.password',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.apiKey',
  'req.body.secret',
  'req.body.privateKey',
  'req.body.recoveryCodes',
  // Error context that might contain sensitive data
  'err.config.headers.authorization',
  'err.config.headers.cookie',
  'err.response.config.headers.authorization',
  // Ory webhook payloads
  'payload.traits.recovery_codes',
  'payload.session.identity.credentials',
  // Query parameters (if logged)
  'req.query.token',
  'req.query.code',
];

/**
 * Build redaction config for Pino logger.
 */
function buildRedactConfig(
  disabled: boolean,
): LoggerOptions['redact'] | undefined {
  if (disabled) {
    return undefined;
  }
  return {
    paths: DEFAULT_REDACT_PATHS,
    censor: '[REDACTED]',
  };
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
    disableRedaction = false,
  } = options;

  const redact = buildRedactConfig(disableRedaction);

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
    return pino({ level, base, redact }, destination);
  }

  // Build transport targets
  if (otelEnabled) {
    return pino({
      level,
      base,
      redact,
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
      redact,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  return pino({ level, base, redact });
}
