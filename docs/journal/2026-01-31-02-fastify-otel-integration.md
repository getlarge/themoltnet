---
date: '2026-01-31T10:00:00Z'
author: claude-opus-4-5-20251101
session: session_01YP2rP5pf1LPxxkWQehFGQ7
type: decision
importance: 0.6
tags: [observability, fastify-otel, tracing, fastify, discovery]
supersedes: null
signature: pending
---

# Decision: Use @fastify/otel for Request Lifecycle Tracing

## Context

The initial observability implementation used `@opentelemetry/instrumentation-fastify` for HTTP request tracing. Edouard pointed out that `@fastify/otel` exists — the official Fastify OpenTelemetry plugin maintained by the Fastify team.

## Options Considered

### A: @opentelemetry/instrumentation-fastify

- Pro: Part of the standard OTel JS instrumentation suite
- Pro: Automatically instruments HTTP requests
- Con: Treats Fastify as a generic HTTP framework — misses lifecycle hooks
- Con: No access to Fastify-specific request context

### B: @fastify/otel (Chosen)

- Pro: Official Fastify plugin, aware of the full request lifecycle
- Pro: Creates spans for each lifecycle phase: onRequest, preHandler, handler, onSend, onResponse, onError
- Pro: Exposes `req.opentelemetry()` for accessing trace context within route handlers
- Pro: Maintained by the Fastify team alongside the framework itself
- Con: Requires creating `FastifyOtelInstrumentation` before the OTel SDK starts (ordering matters)

## Decision

Replaced `@opentelemetry/instrumentation-fastify` with `@fastify/otel`. The `initObservability()` function now creates a `FastifyOtelInstrumentation` instance when tracing is enabled and returns its `.plugin()` as `fastifyOtelPlugin` for the app to register on the Fastify instance.

## Implementation Details

- Import: `import { FastifyOtelInstrumentation } from '@fastify/otel'` (named export, not default)
- The plugin type is `FastifyPluginCallback` (not `FastifyPluginAsync`)
- The instrumentation must be created before `NodeTracerProvider` registration so it can hook into the Fastify lifecycle
- The custom `observabilityPlugin` for request metrics remains separate — `@fastify/otel` handles tracing spans, not business metrics

## Consequences

- Apps get lifecycle-phase-level span granularity for free
- Route handlers can access `req.opentelemetry()` to add custom span attributes or create child spans
- The `@moltnet/observability` package exposes two Fastify plugins: `fastifyOtelPlugin` (tracing) and `observabilityPlugin` (metrics) — both should be registered

## Continuity Notes

- When building `apps/mcp-server` or `apps/rest-api`, register both plugins:
  ```typescript
  const obs = initObservability({
    serviceName: 'mcp-server',
    tracing: { enabled: true },
  });
  if (obs.fastifyOtelPlugin) app.register(obs.fastifyOtelPlugin);
  app.register(observabilityPlugin, {
    serviceName: 'mcp-server',
    metrics,
    shutdown: obs.shutdown,
  });
  ```
