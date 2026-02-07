---
date: '2026-02-07T09:00:00Z'
author: claude-opus-4-6
session: e2e-docker-tests
type: handoff
importance: 0.8
tags: [e2e, docker, testing, infrastructure, ci]
supersedes: null
signature: pending
---

# Move E2E Tests to Target Containerized Server

## Context

The deploy to Fly.io crashed with `Cannot find package 'sqlite3'` — a runtime/bundling issue invisible to E2E tests because they bootstrapped the app in-process via `buildApp()`, never testing the actual Docker image. This meant packaging issues (missing deps, broken bundles) could only be caught in production.

## What Changed

Moved E2E tests from `apps/rest-api/e2e/` to `apps/server/e2e/` and rewired the test harness to point at a containerized server (`localhost:8080`) instead of bootstrapping in-process.

### Key changes:

1. **`libs/auth/src/ory-client.ts`** — Extended `OryClientConfig` with per-service URL overrides (`kratosPublicUrl`, `kratosAdminUrl`, `hydraAdminUrl`, `ketoReadUrl`, `ketoWriteUrl`). When overrides are provided, `createOryClients` creates separate `Configuration` instances per client instead of using a single `baseUrl` for all. Falls back to `baseUrl` when not provided (production with Ory Network unchanged).

2. **`apps/server/src/app.ts`** — Passes all resolved per-service URLs to `createOryClients` so the containerized server connects to each Ory service correctly when they run as separate Docker containers.

3. **`docker-compose.e2e.yaml`** — Added `server` service that builds the Docker image and connects to Ory/Postgres infrastructure with proper healthcheck and `depends_on` conditions.

4. **`apps/server/e2e/setup.ts`** — Docker-mode test harness: `baseUrl` points at `localhost:8080` (container), direct DB connection for voucher scaffolding, Ory admin clients for identity creation. No `app: FastifyInstance` — server lifecycle managed by Docker Compose.

5. **`apps/server/e2e/helpers.ts`** — Removed unused `app: FastifyInstance` parameter from `createAgent()`.

6. **`apps/server/e2e/globalSetup.ts`** — Uses `docker compose -f docker-compose.e2e.yaml up -d --build` (includes server container), waits for server health at `localhost:8080/health` in addition to Ory services.

7. **9 test files** moved from `apps/rest-api/e2e/` → `apps/server/e2e/`, with `app: harness.app` removed from all `createAgent()` calls.

8. **CI workflow** updated: E2E job now runs `pnpm --filter @moltnet/server run test:e2e`.

## Decisions

- **Per-service URL overrides in `createOryClients`** rather than the previous `Object.assign` hack in the test setup. This makes the factory properly support split Ory deployments (Docker Compose, Kubernetes).
- **`hookTimeout: 120_000`** (2 min) in the E2E vitest config to account for Docker image build + container startup.
- **Server `vite.config.ts` excludes `e2e/**`\*\* from regular unit test runs to prevent ECONNREFUSED failures when Docker isn't running.

## What's Next

- Run the full E2E suite against the Docker container to validate (`pnpm --filter @moltnet/server run test:e2e`)
- The same Docker image used in E2E is what gets deployed to Fly.io, so packaging issues will now be caught before deploy
