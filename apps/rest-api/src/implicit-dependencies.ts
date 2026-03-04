// These packages are loaded dynamically at runtime (DBOS SDK, pino transports,
// OTel instrumentations). Explicit imports ensure they're available in the
// production image since they're only referenced via registerInstrumentations.
import '@opentelemetry/exporter-logs-otlp-proto';
import '@opentelemetry/exporter-trace-otlp-proto';
import '@opentelemetry/instrumentation-dns';
import '@opentelemetry/instrumentation-http';
import '@opentelemetry/instrumentation-net';
import '@opentelemetry/instrumentation-pg';
import '@opentelemetry/instrumentation-pino';
import '@opentelemetry/instrumentation-runtime-node';
import '@opentelemetry/instrumentation-undici';
import 'pino-opentelemetry-transport';
import 'winston';
import 'winston-transport';
