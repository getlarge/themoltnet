---
date: '2026-02-06T18:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.8
tags: [handoff, ws7, deployment, combined-server, rest-api]
supersedes: null
signature: pending
---

# Handoff: Combined Server with REST API + Supabase + Ory

## What Was Done This Session

- Extracted `registerApiRoutes()` from REST API `buildApp()` so the combined server can mount all API routes on its own Fastify instance
- Rewrote `apps/server/` to bootstrap all services: database (Supabase), Ory auth (token validation, permissions), diary/embedding/crypto services, observability (Axiom)
- Single Fly.io machine now serves both landing page (`themolt.net`) and REST API (`api.themolt.net`)
- Updated Fly.io config: 1GB memory (for ONNX embedding model), `/health` check, `ORY_PROJECT_URL` + `CORS_ORIGINS` env vars
- Updated Dockerfile: health check path `/health`, 15s start-period
- Added `apps/rest-api/**` to deploy workflow paths trigger
- Fixed `CryptoService.sign` type in `rest-api/types.ts` to match `@moltnet/crypto-service` (string not Uint8Array)
- Wrote `docs/DEPLOY.md` with full deployment guide
- Closed issue #52 (E2E tests for token enrichment) — all criteria met

## What's Not Done Yet

- Fly.io secrets not yet set (documented in `docs/DEPLOY.md`)
- Database schema not pushed to Supabase (`db:push`)
- Ory config not re-deployed (last deployed by PR #107)
- Custom domain `api.themolt.net` not configured on Fly.io
- No local smoke test with Docker infra (E2E tests cover this)

## Current State

- Branch: `claude/deploy-combined-server-42`
- Tests: all passing (unit + existing E2E)
- Build: clean (lint, typecheck, test, build)
- PR: pending creation

## Decisions Made

- `DATABASE_URL` is required — no graceful degradation without a database. The combined server always needs Supabase.
- Removed the old server's standalone `loadServerConfig` and `buildApp` — config delegates entirely to REST API's `loadConfig()`, `resolveOryUrls()`. No duplication.
- Observability is conditional on `AXIOM_API_TOKEN` — falls back to plain Pino logger without it.
- VM memory bumped to 1GB to accommodate the e5-small-v2 ONNX model (~33MB) during inference.

## Open Questions

- `ORY_PROJECT_API_KEY` in `.env` maps to `ORY_API_KEY` on Fly.io, and `AXIOM_API_KEY` maps to `AXIOM_API_TOKEN`. Should we align these names?
- Should `RECOVERY_CHALLENGE_SECRET` be added to `env.public` docs table in `INFRASTRUCTURE.md`?

## Where to Start Next

1. Run the post-merge deploy steps in `docs/DEPLOY.md`
2. Verify `curl https://api.themolt.net/health` returns `{"status":"ok"}`
3. Verify `curl https://themolt.net/` returns landing page
4. After deploy, update WS7 status in `docs/FREEDOM_PLAN.md`
