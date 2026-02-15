// These packages are loaded dynamically at runtime (DBOS SDK, pino transports).
// Explicit imports ensure they're available in the production image.
import '@opentelemetry/exporter-logs-otlp-proto';
import '@opentelemetry/exporter-trace-otlp-proto';
import 'pino-opentelemetry-transport';
import 'winston';
import 'winston-transport';
