---
date: '2026-02-24T18:00:00Z'
author: claude-sonnet-4-6
session: otel-direct-axiom
type: handoff
importance: 0.8
tags: [handoff, observability, opentelemetry, axiom, pino, mcp-server, deps]
supersedes: null
signature: pending
---

# Handoff: OTel Direct-to-Axiom + Auto-Instrumentation (Issue #302)

## What Was Done This Session

### Core observability library (`@moltnet/observability`)

- **`initInstrumentation(config)`** — new export that registers OTel auto-instrumentation patches
  (http, dns, net, pg, pino) via `registerInstrumentations()`. Must be the first import in each
  app's `main.ts` to guarantee patches register before Node.js loads the target modules.
- **`PinoInstrumentation`** — added to inject `trace_id`/`span_id` into Pino log records for
  log-trace correlation in Axiom.
- **Fixed silent log export** — `pino-opentelemetry-transport` was running but silently discarding
  all logs because `logRecordProcessorOptions` was never passed. Now builds a `http/protobuf` batch
  processor pointing to `${otlp.endpoint}/v1/logs` with the appropriate headers.
- **`metricsHeaders`** on `OtlpConfig` — metrics can now go to a separate Axiom dataset
  (`AXIOM_METRICS_DATASET`) vs traces/logs (`AXIOM_DATASET`).
- **`addSpanProcessor` deprecation fixed** — `NodeTracerProvider` now receives `spanProcessors`
  in its constructor config instead of post-construction calls.
- **`Resource` → `resourceFromAttributes`** — OTel SDK 2.x breaking change; `Resource` is now an
  interface, not a class. Updated `tracing.ts` and `metrics.ts`.
- **`parentSpanId` → `parentSpanContext?.spanId`** — `ReadableSpan` API change in SDK 2.x.
  Updated tracing tests accordingly.

### MCP server (was zero observability before)

- Added `@moltnet/observability` as a workspace dependency.
- Added `AXIOM_API_TOKEN`, `OTLP_ENDPOINT`, `AXIOM_DATASET` to `McpServerConfigSchema`.
- Created `apps/mcp-server/src/instrumentation.ts` side-effect file (http, dns, pino; no pg/net
  since MCP server has no direct DB access).
- Updated `main.ts`: instrumentation import first, `initObservability()` when token+endpoint
  present, passes `observability` context to `buildApp()`.
- Updated `app.ts`: accepts optional `ObservabilityContext`, registers `fastifyOtelPlugin` before
  routes and `observabilityPlugin` after.

### REST API

- Replaced `AXIOM_LOGS_DATASET`/`AXIOM_TRACES_DATASET` with `OTLP_ENDPOINT` + `AXIOM_DATASET`.
- Fixed `bootstrap.ts`: removed hardcoded `https://api.axiom.co` — endpoint now comes entirely
  from env. Builds separate `traceAndLogHeaders` and `metricsHeaders` objects.
- Created `apps/rest-api/src/instrumentation.ts` side-effect file (all 5 instrumentations).
- Updated `main.ts` with instrumentation import first.
- Updated `implicit-dependencies.ts` with all 5 instrumentation packages for Vite bundling.

### Deployment config + docs

- Added `OTLP_ENDPOINT`, `AXIOM_DATASET`, `AXIOM_METRICS_DATASET` to `apps/rest-api/fly.toml`.
- Added `OTLP_ENDPOINT`, `AXIOM_DATASET` to `apps/mcp-server/fly.toml`.
- Updated `docs/INFRASTRUCTURE.md` with new env var names, Fly secrets table for MCP server,
  and updated `fly secrets set` commands.

### Dependency upgrades

- `@opentelemetry/api`: `^1.7` → `^1.9.0`
- `@opentelemetry/resources/sdk-*`: `^1.30` → `^2.5.1` (major)
- `@opentelemetry/exporter-*-otlp-proto`: `^0.57` → `^0.212.0`
- `@opentelemetry/semantic-conventions`: `^1.28` → `^1.39.0`
- `pino`: `^9.6` → `^10.3.1` (major)
- `pino-opentelemetry-transport`: `^0.6` → `^3.0.0` (major; now uses `otlp-logger@2.x`)
- `pino-pretty`: `^13.0` → `^13.1.3`

## What's Not Done Yet

- `AXIOM_API_TOKEN` is not yet set as a Fly secret on `moltnet-mcp` (manual step; secret value
  needs to come from the team's `.env.keys`).
- The `@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` packages are brought in transitively
  by `pino-opentelemetry-transport` — no direct usage yet. If we want to emit structured log
  records via the OTel Logs API directly (not just through Pino), that's a future addition.
- `@opentelemetry/host-metrics` (CPU, memory, event-loop lag) not added — out of scope for this
  issue but the plumbing is ready (global `MeterProvider` is set by `initObservability()`).

## Current State

- Branch: `feat/otel-direct-axiom` (rebased on main as of 2026-02-24)
- Commits: 4 commits on top of main
- Tests: 267 passing, 0 failing (full workspace)
- Typecheck: clean across all workspaces
- Build: not explicitly run; no changes to Vite configs or bundler entry points

## Decisions Made

- **No OTel Collector** — exporters send directly to Axiom OTLP endpoints. Simpler ops, no
  extra infra. Collector can be added later if fan-out or sampling is needed.
- **`initInstrumentation()` as side-effect file** — ESM hoists static imports so the only
  safe pattern is a dedicated file that is the first `import` in `main.ts`. This is the
  Node.js OTel recommended pattern and avoids any timing issues with module loading.
- **Two Axiom datasets** — logs+traces share `AXIOM_DATASET`, metrics go to `AXIOM_METRICS_DATASET`
  (optional, falls back to `AXIOM_DATASET`). Axiom has better query ergonomics per signal type.
- **`logRecordProcessorOptions` in transport** — The `pino-opentelemetry-transport` worker thread
  manages its own OTLP log exporter pipeline internally. Without this config the transport runs
  silently but discards all records. This was a subtle non-obvious bug.
- **OTel SDK 2.x upgrade** — took the major version bump since the API surface we use is small
  and the migration was clean. `resourceFromAttributes` factory replaces `new Resource()`.

## Open Questions

- Should we add `@opentelemetry/host-metrics` to capture process-level metrics (CPU, memory,
  event-loop lag)? The MeterProvider is ready; it's a one-liner addition.
- The `observability` variable in `mcp-server/src/main.ts` currently has an implicit `any` type
  (TypeScript hint). Could add an explicit `ObservabilityContext | undefined` annotation.

## Where to Start Next

1. Merge this PR.
2. Set `AXIOM_API_TOKEN` as a Fly secret on `moltnet-mcp`:
   ```bash
   npx @dotenvx/dotenvx run -f .env -- bash -c 'fly secrets set AXIOM_API_TOKEN="$AXIOM_API_TOKEN" --app moltnet-mcp'
   ```
3. Deploy and verify traces/logs/metrics appear in Axiom dashboard.
4. Optionally: add `@opentelemetry/host-metrics` for process-level metrics.
