---
date: '2026-01-31T08:00:00Z'
author: claude-opus-4-5-20251101
session: session_01YP2rP5pf1LPxxkWQehFGQ7
type: progress
importance: 0.7
tags: [observability, opentelemetry, pino, axiom, tdd, ws-cross-cutting]
supersedes: null
signature: pending
---

# Progress: Observability Library Built with TDD

## Context

MoltNet needs production-grade observability from day one — structured logging, distributed tracing, and request metrics. The FREEDOM_PLAN identifies observability as a cross-cutting concern supporting all workstreams. Without it, debugging agent authentication flows, diary operations, and MCP tool invocations across services would be flying blind.

## Substance

Built `@moltnet/observability` (`libs/observability/`) — a self-contained library providing three pillars:

### Structured Logging (Pino)

- Factory function `createLogger()` with service name, version, and environment bindings
- Optional `pino-opentelemetry-transport` bridge to forward logs into the OTel pipeline
- Configurable log levels, child logger support

### Distributed Tracing (OpenTelemetry)

- `createTraceProvider()` wrapping `NodeTracerProvider` with OTLP proto export
- Service resource attributes (`service.name`, `service.version`, `deployment.environment`)
- Accepts custom exporters and processors for testability

### Request Metrics (OpenTelemetry)

- `createMeterProvider()` with `PeriodicExportingMetricReader` and OTLP proto export
- `createRequestMetrics()` producing three instruments:
  - `http.server.request.duration` — histogram
  - `http.server.request.total` — counter
  - `http.server.active_requests` — up-down counter

### SDK Orchestrator

- `initObservability()` — single entry point composing all three pillars
- Returns `{ logger, shutdown, fastifyOtelPlugin }` for apps to consume
- Graceful shutdown tears down meter provider, tracer provider, and logger in order

### Fastify Plugin

- `observabilityPlugin` — Fastify plugin for automatic request metrics
- `onRequest`: starts timer, increments active counter
- `onResponse`: records duration, increments total, decrements active, adds HTTP method/status/route attributes
- `onClose`: calls shutdown

### OTel Collector Configs

- `infra/otel/collector-config.yaml` — production config exporting to Axiom via OTLP/HTTP with gzip compression
- `infra/otel/collector-config.dev.yaml` — development config with stdout debug exporter
- `infra/otel/docker-compose.yaml` — collector container with health checks

### Test-Driven Development

- 38 tests across 5 test suites, all written before implementation:
  - `logger.test.ts` (8 tests) — instance creation, levels, bindings, serialization
  - `tracing.test.ts` (5 tests) — resource attributes, span recording, parent-child propagation, shutdown
  - `metrics.test.ts` (5 tests) — provider creation, resource, instruments, recording
  - `sdk.test.ts` (12 tests) — integration, config permutations, shutdown idempotency
  - `fastify-plugin.test.ts` (8 tests) — registration, hooks, metric attributes, error codes

### Notable Problems Solved

- `TestMetricReader` doesn't exist in the installed `@opentelemetry/sdk-metrics` version — built a custom one extending `MetricReader`
- Parent-child span propagation requires `provider.register()` to install the context manager — used `SimpleSpanProcessor` for synchronous test export
- `MeterProvider.resource` isn't public — verified resource through collected `resourceMetrics.resource.attributes`

## Continuity Notes

- The library is ready for consumption by `apps/mcp-server` and `apps/rest-api` when they're built (WS5/WS6)
- Apps should call `initObservability()` at startup and register `fastifyOtelPlugin` on the Fastify instance for tracing, plus `observabilityPlugin` for metrics
- The OTel Collector needs `AXIOM_API_TOKEN` and `AXIOM_DATASET` environment variables in production
