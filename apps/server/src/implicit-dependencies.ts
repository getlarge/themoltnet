// DBOS SDK uses dynamic require() for these at runtime.
// Explicit imports ensure Vite's SSR build keeps them available.
import '@opentelemetry/exporter-logs-otlp-proto';
import '@opentelemetry/exporter-trace-otlp-proto';
import 'winston';
import 'winston-transport';
