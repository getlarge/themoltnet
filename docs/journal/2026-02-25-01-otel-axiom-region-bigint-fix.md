---
date: '2026-02-25T00:00:00Z'
author: claude-sonnet-4-6
session: fix-otel-bigint
type: handoff
importance: 0.7
tags:
  [
    handoff,
    observability,
    opentelemetry,
    axiom,
    bigint,
    fix,
    mcp-server,
    rest-api,
  ]
supersedes: null
signature: pending
---

# Handoff: OTel Axiom Region Fix + BigInt Crash Fix

## What Was Done This Session

Two bugs prevented telemetry from reaching Axiom after PR #309 merged.

### Bug 1: BigInt crash in mcp-server (production)

**Symptom:** Every request to the MCP server threw `TypeError: Cannot mix BigInt and other types`,
visible in Fly.io logs. This crashed the `@fastify/otel` span lifecycle, dropping all traces.

**Root cause:** `libs/observability/src/fastify-plugin.ts` declared `request.startTime: bigint`
(non-optional) but only assigned it in the `onRequest` hook. In edge cases (route not found, early
termination), `onResponse` fires without a prior `onRequest`, so `request.startTime` is `undefined`
at runtime. Subtracting `undefined` from a `bigint` throws a TypeError.

**Fix:**

- Changed declaration to `startTime: bigint | undefined`
- Destructured `startTime` in `onResponse` for TypeScript narrowing
- Used a ternary: `startTime ? Number(now - startTime) / 1_000_000 : 0`
- Added regression test covering the undefined-startTime path

### Bug 2: rest-api sending nothing to Axiom (silent HTTP 400)

**Symptom:** No traces, logs, or metrics in Axiom dashboard despite the observability stack
initialising correctly.

**Root cause:** `OTLP_ENDPOINT` was set to `https://api.axiom.co` (US) in both `fly.toml` files,
but the Axiom organisation is on the EU region. Axiom returns HTTP 400 `{"message":"mismatched region"}`.
The error was completely silent without diagnostic logging — spans were generated, batched, and
exported over HTTPS but silently rejected.

**Diagnosed via:** Added `DiagConsoleLogger` at `DEBUG` level to `sdk.ts`, restarted locally with a
real `AXIOM_API_TOKEN`. The `OTLPExportDelegate` output confirmed spans were being created and sent;
the tail of the log showed `Export failed with non-retryable error: OTLPExporterError: Bad Request`
with the `mismatched region` message.

**Fix:**

- Updated `OTLP_ENDPOINT` to `https://api.eu.axiom.co` in both `apps/mcp-server/fly.toml` and
  `apps/rest-api/fly.toml`
- Kept `DiagConsoleLogger` at `WARN` level (not DEBUG) so export failures remain visible in
  production logs without the verbose span dumps

### Bonus: .env key rename

`AXIOM_API_KEY` in `.env` was renamed to `AXIOM_API_TOKEN` to match the env var name expected by
the apps and the Fly.io secret. The old `INFRASTRUCTURE.md` note documenting the mismatch was removed.

## What Was Investigated But Not Changed

**DBOS TracerProvider overwrite hypothesis** — investigated whether DBOS calling
`trace.setGlobalTracerProvider()` could overwrite our Axiom-configured provider. Partially confirmed
(the `Tracer` constructor does call `setGlobalTracerProvider` when `enableOTLP=true`), but this
turned out not to be the root cause. The actual root cause was the region mismatch. `enableOTLP`
remains at its default value.

## Current State

- Branch: `fix/otel-bigint-starttime`
- Commits: 4 on top of main
  - `fix(observability): guard against undefined startTime in onResponse hook`
  - `fix(observability): correct Axiom EU endpoint, add OTel diag logging`
  - `fix(observability): rename AXIOM_API_KEY to AXIOM_API_TOKEN in .env`
  - `docs(infrastructure): remove stale AXIOM_API_KEY mapping note`
- Tests: not re-run this session (BigInt fix regression test added in first commit)

## Where to Start Next

1. Merge this branch.
2. Deploy both apps — the `fly.toml` changes take effect on next deploy.
3. Verify traces, logs, and metrics appear in the Axiom EU dashboard.
4. If `AXIOM_API_TOKEN` is not yet set as a Fly secret on `moltnet-mcp`, set it:
   ```bash
   npx @dotenvx/dotenvx run -f .env -- bash -c 'fly secrets set AXIOM_API_TOKEN="$AXIOM_API_TOKEN" --app moltnet-mcp'
   ```
