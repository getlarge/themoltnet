---
date: '2026-02-01T18:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.8
tags: [handoff, ws7, deployment, fly-io, landing-page]
supersedes: null
signature: pending
---

# Handoff: WS7 Phase 1 — Landing Page Deployed to Fly.io

## What Was Done This Session

- Created `apps/server/` — Fastify server with `@fastify/static`, SPA fallback, `/healthz`
- TypeBox-validated config module (PORT, NODE_ENV, STATIC_DIR)
- Multi-stage Dockerfile (node:22-slim) building landing (Vite) + server (tsc)
- `fly.toml` for Frankfurt deployment with auto-stop and health checks
- GitHub Actions deploy workflow (GHCR build + Fly.io deploy via image digest)
- Set `FLY_API_TOKEN` GitHub secret for automated deploys
- Configured TLS certificate for `themolt.net` via Let's Encrypt
- DNS records updated: A + AAAA pointing to Fly.io IPs

## What's Not Done Yet

- Observability integration (`@moltnet/observability` plugin) — deferred to reduce Phase 1 complexity
- REST API route mounting under `/api/v1/` — depends on WS3/WS4 completion
- MCP server integration — depends on WS5
- `www.themolt.net` certificate (Fly.io suggested adding it)

## Current State

- Branch: `claude/ws7-deploy-landing-page`
- Tests: 358 passing (2 new server tests), 0 failing
- Build: clean (typecheck, lint, build all pass)
- Live: `https://themolt.net` serving landing page, healthz OK
- Fly.io: 2 machines in `fra`, auto-stop enabled, shared CPU 256MB

## Decisions Made

- Used `@fastify/static` directly instead of a reverse proxy — simpler for Phase 1
- SPA fallback only for GET requests; POST/PUT/etc return 404
- `resolveStaticDir` tries Docker path (`/app/public`) first, then local dev path (`../../landing/dist` relative to source)
- Deploy workflow uses two-job pipeline: build+push to GHCR, then deploy exact digest to Fly.io
- Port 8080 as default (Fly.io internal port convention)

## Plan Deviation

- Fixed `resolveStaticDir` path: plan had `../../../landing/dist` (3 levels up from `src/`) but correct path is `../../landing/dist` (2 levels). Verified in both dev and Docker contexts.

## Open Questions

- Should `www.themolt.net` redirect to `themolt.net`? Fly.io flagged it.
- When WS3/WS4 are ready, the server will need Fly.io secrets for DATABASE_URL, ORY_API_KEY, etc.

## Continuity Notes

Extending the server for Phase 2 is straightforward:

1. Add REST API as a Fastify plugin under `/api/v1/`
2. Add observability via `@moltnet/observability`
3. Set Fly.io secrets: `fly secrets set DATABASE_URL=... ORY_API_KEY=...`
4. The Dockerfile already copies all libs source, so new workspace deps resolve automatically
