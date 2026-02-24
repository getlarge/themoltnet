# OTel Direct-to-Axiom + Auto-Instrumentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `initInstrumentation()` to `@moltnet/observability` for ESM-safe auto-instrumentation (http, dns, net, pg), fix the OTLP exporter config so no endpoint or dataset is hardcoded, and wire full observability into the MCP server.

**Architecture:** The observability lib gains a new `instrumentation.ts` module that wraps OTel's `registerInstrumentations()` behind a typed config interface. Each app gets a side-effect `instrumentation.ts` that is the first import in `main.ts` — guaranteeing monkey-patches land before `pg`/`http` load in the ESM module graph. The `OtlpConfig` type gains a `metricsHeaders` field so trace and metrics signals can route to different Axiom datasets. All endpoint URLs and auth headers come from env vars only.

**Tech Stack:** `@opentelemetry/instrumentation`, `@opentelemetry/instrumentation-{http,net,dns,pg}`, TypeBox, pnpm workspace catalogs, Fastify, Fly.io env secrets.

---

## Background

The codebase today:

- `libs/observability/src/sdk.ts` — `initObservability()` creates trace + metrics providers and wires OTLP exporters. The `OtlpConfig.headers` field is used for **both** trace and metrics exporters, so they always share the same `X-Axiom-Dataset`.
- `apps/rest-api/src/bootstrap.ts` — hardcodes `'https://api.axiom.co'` as the OTLP endpoint. Also uses `AXIOM_TRACES_DATASET` for both traces and metrics.
- `apps/rest-api/src/config.ts` — `ObservabilityConfigSchema` has `AXIOM_LOGS_DATASET`, `AXIOM_TRACES_DATASET`, `AXIOM_METRICS_DATASET` — inconsistent with what bootstrap actually uses.
- `apps/mcp-server/` — zero observability wiring; `main.ts` passes a plain Pino config to Fastify.
- No `@opentelemetry/instrumentation-*` packages exist anywhere.

ESM constraint: static `import` declarations execute in order before any module body code. So `instrumentation.ts` must be the **first import** in `main.ts` to guarantee OTel patches are applied before `pg`, `http`, etc. load via downstream imports.

---

## Task 1: Add instrumentation packages to pnpm catalog

**Files:**

- Modify: `pnpm-workspace.yaml`

**Step 1: Add to catalog**

In `pnpm-workspace.yaml`, add under `catalog:`:

```yaml
'@opentelemetry/instrumentation': ^0.57.0
'@opentelemetry/instrumentation-http': ^0.57.0
'@opentelemetry/instrumentation-net': ^0.57.0
'@opentelemetry/instrumentation-dns': ^0.57.0
'@opentelemetry/instrumentation-pg': ^0.57.0
```

**Step 2: Install**

```bash
pnpm install
```

Expected: packages resolve, lockfile updates, no errors.

**Step 3: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(deps): add OTel instrumentation packages to catalog"
```

---

## Task 2: Add instrumentation packages to `@moltnet/observability`

**Files:**

- Modify: `libs/observability/package.json`

**Step 1: Add deps**

In `libs/observability/package.json`, under `"dependencies"`, add:

```json
"@opentelemetry/instrumentation": "catalog:",
"@opentelemetry/instrumentation-http": "catalog:",
"@opentelemetry/instrumentation-net": "catalog:",
"@opentelemetry/instrumentation-dns": "catalog:",
"@opentelemetry/instrumentation-pg": "catalog:"
```

**Step 2: Install**

```bash
pnpm install
```

**Step 3: Commit**

```bash
git add libs/observability/package.json pnpm-lock.yaml
git commit -m "chore(observability): add OTel instrumentation package deps"
```

---

## Task 3: Create `libs/observability/src/instrumentation.ts`

**Files:**

- Create: `libs/observability/src/instrumentation.ts`
- Test: `libs/observability/__tests__/instrumentation.test.ts`

**Step 1: Write the failing test**

Create `libs/observability/__tests__/instrumentation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock registerInstrumentations before importing the module under test
vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: vi.fn(),
}));
vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: vi
    .fn()
    .mockImplementation((opts) => ({ _opts: opts, type: 'http' })),
}));
vi.mock('@opentelemetry/instrumentation-net', () => ({
  NetInstrumentation: vi.fn().mockImplementation(() => ({ type: 'net' })),
}));
vi.mock('@opentelemetry/instrumentation-dns', () => ({
  DnsInstrumentation: vi.fn().mockImplementation(() => ({ type: 'dns' })),
}));
vi.mock('@opentelemetry/instrumentation-pg', () => ({
  PgInstrumentation: vi.fn().mockImplementation(() => ({ type: 'pg' })),
}));

import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { initInstrumentation } from '../src/instrumentation.js';

describe('initInstrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all instrumentations by default', () => {
    initInstrumentation({});
    expect(registerInstrumentations).toHaveBeenCalledOnce();
    const { instrumentations } = (
      registerInstrumentations as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const types = instrumentations.map((i: { type: string }) => i.type);
    expect(types).toContain('http');
    expect(types).toContain('net');
    expect(types).toContain('dns');
    expect(types).toContain('pg');
  });

  it('excludes pg when pg: false', () => {
    initInstrumentation({ pg: false });
    const { instrumentations } = (
      registerInstrumentations as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const types = instrumentations.map((i: { type: string }) => i.type);
    expect(types).not.toContain('pg');
  });

  it('excludes net and dns when disabled', () => {
    initInstrumentation({ net: false, dns: false });
    const { instrumentations } = (
      registerInstrumentations as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const types = instrumentations.map((i: { type: string }) => i.type);
    expect(types).not.toContain('net');
    expect(types).not.toContain('dns');
  });

  it('passes httpIgnoreIncomingPaths to HttpInstrumentation', () => {
    const {
      HttpInstrumentation,
    } = require('@opentelemetry/instrumentation-http');
    initInstrumentation({ httpIgnoreIncomingPaths: ['/health'] });
    expect(HttpInstrumentation).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreIncomingRequestHook: expect.any(Function),
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @moltnet/observability run test -- --reporter=verbose
```

Expected: FAIL — `initInstrumentation` not found.

**Step 3: Implement `instrumentation.ts`**

Create `libs/observability/src/instrumentation.ts`:

````typescript
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { IncomingMessage } from 'node:http';

export interface InstrumentationConfig {
  /** Enable HTTP client/server instrumentation (default: true) */
  http?: boolean;
  /** Enable DNS instrumentation (default: true) */
  dns?: boolean;
  /** Enable net (TCP socket) instrumentation (default: true) */
  net?: boolean;
  /** Enable pg (PostgreSQL) instrumentation (default: true) */
  pg?: boolean;
  /**
   * Incoming HTTP request paths to suppress from tracing.
   * Health check endpoints should be listed here.
   * e.g. ['/health', '/healthz']
   */
  httpIgnoreIncomingPaths?: string[];
}

/**
 * Register OTel auto-instrumentation for common Node.js modules.
 *
 * MUST be called before any other imports that load pg, http, net, or dns.
 * In ESM, place this in a dedicated side-effect module that is the first
 * import in the app entrypoint:
 *
 * ```ts
 * // instrumentation.ts (app-level)
 * import { initInstrumentation } from '@moltnet/observability';
 * initInstrumentation({ pg: true, httpIgnoreIncomingPaths: ['/health'] });
 * ```
 *
 * ```ts
 * // main.ts
 * import './instrumentation.js'; // ← MUST be first
 * import { bootstrap } from './bootstrap.js';
 * ```
 *
 * The registered instrumentations will use the global TracerProvider once
 * it is set by `initObservability()`. Order matters: call this function
 * first, then call `initObservability()`.
 */
export function initInstrumentation(config: InstrumentationConfig): void {
  const {
    http = true,
    dns = true,
    net = true,
    pg = true,
    httpIgnoreIncomingPaths = [],
  } = config;

  const instrumentations = [];

  if (http) {
    instrumentations.push(
      new HttpInstrumentation({
        ignoreIncomingRequestHook:
          httpIgnoreIncomingPaths.length > 0
            ? (req: IncomingMessage) => {
                const url = req.url ?? '';
                return httpIgnoreIncomingPaths.some((path) =>
                  url.startsWith(path),
                );
              }
            : undefined,
      }),
    );
  }

  if (dns) {
    instrumentations.push(new DnsInstrumentation());
  }

  if (net) {
    instrumentations.push(new NetInstrumentation());
  }

  if (pg) {
    instrumentations.push(new PgInstrumentation());
  }

  registerInstrumentations({ instrumentations });
}
````

**Step 4: Run tests**

```bash
pnpm --filter @moltnet/observability run test -- --reporter=verbose
```

Expected: all instrumentation tests pass.

**Step 5: Commit**

```bash
git add libs/observability/src/instrumentation.ts libs/observability/__tests__/instrumentation.test.ts
git commit -m "feat(observability): add initInstrumentation() for http/dns/net/pg auto-instrumentation"
```

---

## Task 4: Update `OtlpConfig` to support per-signal headers + update `sdk.ts`

**Files:**

- Modify: `libs/observability/src/types.ts`
- Modify: `libs/observability/src/sdk.ts`
- Modify: `libs/observability/__tests__/sdk.test.ts` (extend existing tests)

**Context:** `OtlpConfig.endpoint` is currently used as a base URL with `/v1/traces` and `/v1/metrics` appended. The `headers` field is shared. We need `metricsHeaders` for an optional override so traces and metrics can go to different Axiom datasets. We also need to remove the hardcoded `'https://api.axiom.co'` from `bootstrap.ts` — the `endpoint` in `OtlpConfig` is the full base URL, configured entirely from env.

**Step 1: Update `types.ts`**

In `libs/observability/src/types.ts`, change `OtlpConfig`:

```typescript
export interface OtlpConfig {
  /**
   * OTLP HTTP base endpoint URL.
   * Traces are sent to `${endpoint}/v1/traces`, metrics to `${endpoint}/v1/metrics`.
   * For Axiom: 'https://api.axiom.co'
   * For local Collector: 'http://localhost:4318'
   */
  endpoint: string;
  /** Headers for trace and log exporters (e.g. Authorization + X-Axiom-Dataset) */
  headers?: Record<string, string>;
  /**
   * Headers override for the metrics exporter.
   * When set, the metrics exporter uses these headers instead of `headers`.
   * Use when traces and metrics go to different Axiom datasets.
   */
  metricsHeaders?: Record<string, string>;
}
```

**Step 2: Update `sdk.ts`**

In `libs/observability/src/sdk.ts`, in `initObservability()`, change the metrics exporter construction (around line 94–99) to use `metricsHeaders` when present:

```typescript
const reader = otlp
  ? new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otlp.endpoint}/v1/metrics`,
        headers: otlp.metricsHeaders ?? otlp.headers,
      }),
      exportIntervalMillis: metricsConfig.exportIntervalMs ?? 60_000,
    })
  : undefined;
```

**Step 3: Run tests**

```bash
pnpm --filter @moltnet/observability run test
```

Expected: all existing tests still pass (no breakage — `metricsHeaders` is additive).

**Step 4: Export `initInstrumentation` from index**

In `libs/observability/src/index.ts`, add:

```typescript
export type { InstrumentationConfig } from './instrumentation.js';
export { initInstrumentation } from './instrumentation.js';
```

**Step 5: Typecheck**

```bash
pnpm --filter @moltnet/observability run typecheck
```

Expected: no errors.

**Step 6: Commit**

```bash
git add libs/observability/src/types.ts libs/observability/src/sdk.ts libs/observability/src/index.ts
git commit -m "feat(observability): add metricsHeaders to OtlpConfig, export initInstrumentation"
```

---

## Task 5: Fix `rest-api` config + bootstrap — no hardcoded endpoints

**Files:**

- Modify: `apps/rest-api/src/config.ts`
- Modify: `apps/rest-api/src/bootstrap.ts`

**Context:**

Current `ObservabilityConfigSchema` has:

- `AXIOM_API_TOKEN` — keep
- `AXIOM_LOGS_DATASET`, `AXIOM_TRACES_DATASET`, `AXIOM_METRICS_DATASET` — replace

Replace with:

- `OTLP_ENDPOINT` — the full base URL (e.g. `https://api.axiom.co`). Optional; when absent, observability is disabled even if token is set.
- `AXIOM_DATASET` — dataset for logs + traces
- `AXIOM_METRICS_DATASET` — dataset for metrics (falls back to `AXIOM_DATASET`)

`bootstrap.ts` currently hardcodes `'https://api.axiom.co'`. After this task, the endpoint comes entirely from `OTLP_ENDPOINT`.

**Step 1: Update `ObservabilityConfigSchema` in `config.ts`**

Replace the existing `ObservabilityConfigSchema`:

```typescript
export const ObservabilityConfigSchema = Type.Object({
  AXIOM_API_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
  /** Full OTLP HTTP base URL, e.g. https://api.axiom.co or http://otel-collector:4318 */
  OTLP_ENDPOINT: Type.Optional(Type.String({ minLength: 1 })),
  /** Axiom dataset for logs + traces */
  AXIOM_DATASET: Type.Optional(Type.String({ minLength: 1 })),
  /** Axiom dataset for metrics (falls back to AXIOM_DATASET) */
  AXIOM_METRICS_DATASET: Type.Optional(Type.String({ minLength: 1 })),
});
```

Also update `ObservabilityEnvConfig` type alias — it's derived via `Static<typeof ObservabilityConfigSchema>` so it updates automatically.

**Step 2: Update `bootstrap.ts`**

Change the observability init block. The condition now requires both `AXIOM_API_TOKEN` and `OTLP_ENDPOINT`:

```typescript
const { AXIOM_API_TOKEN, OTLP_ENDPOINT, AXIOM_DATASET, AXIOM_METRICS_DATASET } =
  config.observability;

if (AXIOM_API_TOKEN && OTLP_ENDPOINT) {
  const traceAndLogHeaders: Record<string, string> = {
    Authorization: `Bearer ${AXIOM_API_TOKEN}`,
    ...(AXIOM_DATASET ? { 'X-Axiom-Dataset': AXIOM_DATASET } : {}),
  };
  const metricsDataset = AXIOM_METRICS_DATASET ?? AXIOM_DATASET;
  const metricsHeaders: Record<string, string> = {
    Authorization: `Bearer ${AXIOM_API_TOKEN}`,
    ...(metricsDataset ? { 'X-Axiom-Dataset': metricsDataset } : {}),
  };

  observability = initObservability({
    serviceName: 'moltnet-server',
    serviceVersion: '0.1.0',
    environment: config.server.NODE_ENV,
    otlp: {
      endpoint: OTLP_ENDPOINT,
      headers: traceAndLogHeaders,
      metricsHeaders,
    },
    logger: {
      level: config.server.NODE_ENV === 'production' ? 'info' : 'debug',
      pretty: config.server.NODE_ENV !== 'production',
    },
    tracing: {
      enabled: true,
      ignorePaths: '/health',
    },
    metrics: { enabled: true },
  });
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/rest-api/src/config.ts apps/rest-api/src/bootstrap.ts
git commit -m "fix(rest-api): remove hardcoded Axiom endpoint, use OTLP_ENDPOINT env var, fix dataset config"
```

---

## Task 6: Add `instrumentation.ts` side-effect file to `rest-api`

**Files:**

- Create: `apps/rest-api/src/instrumentation.ts`
- Modify: `apps/rest-api/src/main.ts`
- Modify: `apps/rest-api/src/implicit-dependencies.ts`

**Step 1: Create `apps/rest-api/src/instrumentation.ts`**

```typescript
/**
 * OTel auto-instrumentation registration.
 *
 * This file MUST be imported first in main.ts — before any module that
 * transitively imports pg, http, net, or dns. In ESM, imports execute
 * in declaration order, so placing this first guarantees the monkey-patches
 * land before those modules load.
 */
import { initInstrumentation } from '@moltnet/observability';

initInstrumentation({
  http: true,
  dns: true,
  net: true,
  pg: true,
  httpIgnoreIncomingPaths: ['/health', '/ready'],
});
```

**Step 2: Update `apps/rest-api/src/main.ts`**

Add `import './instrumentation.js'` as the very first import:

```typescript
import './instrumentation.js'; // ← MUST be first: patches pg/http/net/dns
import './implicit-dependencies.js';

import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, dbConnection } = await bootstrap(config);

  try {
    await app.listen({ port: config.server.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app
        .close()
        .then(() => dbConnection.pool.end())
        .then(() => process.exit(0));
    });
  }
}

void main();
```

**Step 3: Update `apps/rest-api/src/implicit-dependencies.ts`**

Add the instrumentation packages so Vite bundles them (they're only referenced via `registerInstrumentations` at runtime):

```typescript
// These packages are loaded dynamically at runtime (DBOS SDK, pino transports, OTel instrumentations).
// Explicit imports ensure they're available in the production image.
import '@opentelemetry/exporter-logs-otlp-proto';
import '@opentelemetry/exporter-trace-otlp-proto';
import '@opentelemetry/instrumentation-dns';
import '@opentelemetry/instrumentation-http';
import '@opentelemetry/instrumentation-net';
import '@opentelemetry/instrumentation-pg';
import 'pino-opentelemetry-transport';
import 'winston';
import 'winston-transport';
```

**Step 4: Typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 5: Commit**

```bash
git add apps/rest-api/src/instrumentation.ts apps/rest-api/src/main.ts apps/rest-api/src/implicit-dependencies.ts
git commit -m "feat(rest-api): add ESM-safe OTel auto-instrumentation (http/dns/net/pg)"
```

---

## Task 7: Wire observability into MCP server

**Files:**

- Modify: `apps/mcp-server/src/config.ts`
- Modify: `apps/mcp-server/src/app.ts`
- Modify: `apps/mcp-server/src/main.ts`
- Create: `apps/mcp-server/src/instrumentation.ts`
- Modify: `apps/mcp-server/package.json`

**Step 1: Add `@moltnet/observability` to mcp-server deps**

In `apps/mcp-server/package.json`, add to `"dependencies"`:

```json
"@moltnet/observability": "workspace:*"
```

Run `pnpm install`.

**Step 2: Add observability config fields to `config.ts`**

In `apps/mcp-server/src/config.ts`, add to `McpServerConfigSchema`:

```typescript
AXIOM_API_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
/** Full OTLP HTTP base URL, e.g. https://api.axiom.co */
OTLP_ENDPOINT: Type.Optional(Type.String({ minLength: 1 })),
/** Axiom dataset for logs + traces */
AXIOM_DATASET: Type.Optional(Type.String({ minLength: 1 })),
```

No separate `AXIOM_METRICS_DATASET` for the MCP server — it's lightweight and shares one dataset.

**Step 3: Update `app.ts` to accept observability context**

Change `AppOptions` and `buildApp`:

```typescript
import type { ObservabilityContext } from '@moltnet/observability';
import { observabilityPlugin } from '@moltnet/observability';

export interface AppOptions {
  config: McpServerConfig;
  deps: McpDeps;
  logger?: boolean | object;
  observability?: ObservabilityContext;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, deps, logger = true, observability } = options;

  const app = observability?.logger
    ? Fastify({ loggerInstance: observability.logger })
    : Fastify({ logger });

  // Register @fastify/otel BEFORE routes for full lifecycle tracing
  if (observability?.fastifyOtelPlugin) {
    await app.register(observability.fastifyOtelPlugin);
  }

  // Health check (excluded from auth)
  app.get('/healthz', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ... rest of buildApp unchanged until the end ...

  // Register observability metrics + shutdown hook
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-mcp',
      shutdown: observability.shutdown,
    });
  }

  return app;
}
```

**Step 4: Create `apps/mcp-server/src/instrumentation.ts`**

```typescript
/**
 * OTel auto-instrumentation for the MCP server.
 * No pg/net — MCP server does not access the database directly.
 * MUST be the first import in main.ts.
 */
import { initInstrumentation } from '@moltnet/observability';

initInstrumentation({
  http: true,
  dns: true,
  net: false,
  pg: false,
  httpIgnoreIncomingPaths: ['/healthz'],
});
```

**Step 5: Update `main.ts`**

```typescript
import './instrumentation.js'; // ← MUST be first

import { initObservability } from '@moltnet/observability';
import { createClient } from '@moltnet/api-client';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { McpDeps } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Init observability before building the app (sets global providers)
  let observability;
  if (config.AXIOM_API_TOKEN && config.OTLP_ENDPOINT) {
    const dataset = config.AXIOM_DATASET;
    observability = initObservability({
      serviceName: 'moltnet-mcp',
      serviceVersion: '0.1.0',
      environment: config.NODE_ENV,
      otlp: {
        endpoint: config.OTLP_ENDPOINT,
        headers: {
          Authorization: `Bearer ${config.AXIOM_API_TOKEN}`,
          ...(dataset ? { 'X-Axiom-Dataset': dataset } : {}),
        },
      },
      logger: {
        level: config.NODE_ENV === 'production' ? 'info' : 'debug',
        pretty: config.NODE_ENV !== 'production',
      },
      tracing: { enabled: true, ignorePaths: '/healthz' },
      metrics: { enabled: true },
    });
  }

  const client = createClient({ baseUrl: config.REST_API_URL });
  const deps: McpDeps = { client };

  const app = await buildApp({
    config,
    deps,
    logger:
      config.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty' } },
    observability,
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start MCP server');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
```

**Step 6: Typecheck**

```bash
pnpm --filter @moltnet/mcp-server run typecheck
```

Expected: no errors.

**Step 7: Commit**

```bash
git add apps/mcp-server/src/instrumentation.ts apps/mcp-server/src/config.ts apps/mcp-server/src/app.ts apps/mcp-server/src/main.ts apps/mcp-server/package.json pnpm-lock.yaml
git commit -m "feat(mcp-server): add full observability stack (Axiom OTLP, auto-instrumentation)"
```

---

## Task 8: Update Fly.io env + docs

**Files:**

- Modify: `apps/rest-api/fly.toml` — add `OTLP_ENDPOINT` to `[env]` (non-secret)
- Modify: `apps/mcp-server/fly.toml` — add `OTLP_ENDPOINT` to `[env]`
- Modify: `docs/INFRASTRUCTURE.md` — update secrets tables and env var lists

**Step 1: Add `OTLP_ENDPOINT` to `fly.toml` env sections**

In `apps/rest-api/fly.toml`, add to `[env]`:

```toml
OTLP_ENDPOINT = "https://api.axiom.co"
AXIOM_DATASET = "moltnet"
```

In `apps/mcp-server/fly.toml`, add to `[env]`:

```toml
OTLP_ENDPOINT = "https://api.axiom.co"
AXIOM_DATASET = "moltnet"
```

`AXIOM_METRICS_DATASET` for rest-api is a Fly secret (it's a dataset name, not sensitive, but keep it alongside the token). Actually it's not sensitive — put it in `fly.toml` too:

```toml
AXIOM_METRICS_DATASET = "moltnet-metrics"
```

`AXIOM_API_TOKEN` stays as a Fly secret (set via `fly secrets set`).

**Step 2: Update `docs/INFRASTRUCTURE.md`**

In the secrets table for `moltnet` (server), update:

- Remove `AXIOM_API_TOKEN: No` → keep it as `AXIOM_API_TOKEN: No (enables observability when set)`
- Add note that `OTLP_ENDPOINT`, `AXIOM_DATASET`, `AXIOM_METRICS_DATASET` are in `fly.toml` (non-secret)

In the "Variables not yet in env files" section, replace `AXIOM_DATASET=moltnet` with:

```bash
OTLP_ENDPOINT=https://api.axiom.co
AXIOM_DATASET=moltnet
AXIOM_METRICS_DATASET=moltnet-metrics
```

**Step 3: Full typecheck + test run**

```bash
pnpm run typecheck
pnpm run test
```

Expected: all green.

**Step 4: Commit**

```bash
git add apps/rest-api/fly.toml apps/mcp-server/fly.toml docs/INFRASTRUCTURE.md
git commit -m "chore: add OTLP_ENDPOINT and Axiom dataset config to fly.toml and docs"
```

---

## Verification

### Local (no Axiom token)

```bash
# Both apps should start without observability (OTLP_ENDPOINT / AXIOM_API_TOKEN not set)
pnpm run dev:api
curl http://localhost:8000/health
# Expected: {"status":"ok"} with no errors in logs

pnpm run dev:mcp
curl http://localhost:8001/healthz
# Expected: {"status":"ok","timestamp":"..."}
```

### With observability enabled (local Collector)

```bash
# Start local OTel Collector (stdout exporter)
docker compose -f infra/otel/docker-compose.yaml up -d

# Set env vars pointing to local Collector
OTLP_ENDPOINT=http://localhost:4318 AXIOM_API_TOKEN=fake AXIOM_DATASET=test pnpm run dev:api
```

Check Collector stdout for span/metric output after hitting API endpoints.

### Fly.io (production)

```bash
fly secrets set AXIOM_API_TOKEN=<token> --app moltnet
fly deploy --app moltnet
fly logs --app moltnet
```

Then check Axiom dashboard → dataset `moltnet` for incoming traces and logs, `moltnet-metrics` for metrics.

### pg span verification

After a diary create/search call, check Axiom traces for spans with `db.system = postgresql`.

### Auto-instrumentation coverage check

Outbound HTTP calls (Ory API, etc.) should produce client spans with `http.method`, `http.url`, `http.status_code` attributes.
