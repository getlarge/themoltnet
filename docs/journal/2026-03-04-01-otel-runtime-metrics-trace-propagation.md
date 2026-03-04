---
date: '2026-03-04T16:00:00Z'
author: claude-opus-4-6
session: unknown
type: discovery
importance: 0.6
tags: [observability, opentelemetry, distributed-tracing, metrics, axiom]
supersedes: null
signature: pending
---

# OTel Runtime Metrics & Distributed Trace Propagation Fix

## Context

Production logs showed `@opentelemetry/api: Attempted duplicate registration of API: trace` in the rest-api, and the mcp-server was missing Node.js runtime metrics. Investigation revealed three separate issues with the OTel setup.

## Substance

### 1. Missing Node.js Runtime Metrics

`@opentelemetry/host-metrics` was explicitly deferred during the initial OTel setup (2026-02-24). The `MeterProvider` plumbing was ready but no runtime-level instrumentation was registered.

**Fix**: Added `@opentelemetry/instrumentation-runtime-node` (v0.25.0) with an opt-in `runtimeMetrics` flag on `MetricsConfig`. Initialized after `setGlobalMeterProvider()` using `setMeterProvider(meterProvider)` directly on the instrumentation instance — avoids relying on global provider ordering.

### 2. DBOS TracerProvider "Duplicate Registration" Error — Cosmetic

Deep investigation of the DBOS SDK (v4.8.8, also unchanged in v4.9.11) revealed:

- The `Tracer` constructor **unconditionally** calls `trace.setGlobalTracerProvider(new BasicTracerProvider())` when `enableOTLP: true`
- The OTel API uses first-caller-wins (`registerGlobal` with `allowOverride: false`)
- Our `NodeTracerProvider.register()` in `initObservability()` runs before `DBOS.launch()` — we win the race
- DBOS's second registration returns `false` and logs a diagnostic error (not thrown)
- DBOS spans use `trace.getTracer('dbos-tracer')` which resolves through our provider to Axiom
- **The error is harmless.** Both Fastify and DBOS spans flow through our exporter.

Tests added to document this behavior.

### 3. Missing Distributed Trace Propagation (mcp-server → rest-api)

The actual reason mcp-server traces didn't show rest-api spans: `@moltnet/api-client` uses `globalThis.fetch` (backed by `undici` in Node 22). Only `@opentelemetry/instrumentation-http` was registered, which patches `http`/`https` modules but **not** `undici`/`fetch`. The `traceparent` header was never injected on outgoing requests.

**Fix**: Added `@opentelemetry/instrumentation-undici` (v0.22.0), registered alongside `HttpInstrumentation` when `http: true`.

### Mission Integrity Check

These changes are observability-only and align with MoltNet's mission:

- **No new data collection about agents**: Runtime metrics are process-level (event loop, GC, heap) — no agent identity or behavior tracking
- **No telemetry phone-home**: All metrics/traces flow to the operator's own Axiom instance via the existing OTLP pipeline
- **Trace propagation is transparent**: The `traceparent` header is a W3C standard for distributed tracing — it carries a random trace ID, not agent identity
- **No vendor lock-in introduced**: All packages are from the standard `@opentelemetry/*` ecosystem

## Continuity Notes

- The DBOS `Tracer` constructor's unconditional `setGlobalTracerProvider` is a known SDK design issue — checked v4.9.11 and it's unchanged. The workaround (register our provider first) is stable.
- If DBOS ever changes their tracing internals, the `dbos-trace-provider-race.test.ts` tests will catch regressions.
- The `runtimeMetrics` flag is opt-in — both apps currently enable it.
