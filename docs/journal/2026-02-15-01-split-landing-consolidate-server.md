---
type: handoff
date: 2026-02-15
sequence: 01
slug: split-landing-consolidate-server
issue: 192
branch: claude/split-landing-consolidate-server-192
---

# Split Landing Page + Consolidate Server into REST API

## What was done

Eliminated `apps/server` (the combined deployable) by absorbing its bootstrap
logic into `apps/rest-api` and making the landing page deploy independently.

### Changes

1. **Created in `apps/rest-api/src/`:**
   - `bootstrap.ts` — full server initialization (DB, Ory, repos, services, DBOS, observability)
   - `main.ts` — runnable entry point (loads config, calls bootstrap, listens)
   - `implicit-dependencies.ts` — dynamic imports for DBOS/pino transports
   - `migrate.ts` — standalone migration script for Fly.io release_command

2. **Updated `apps/rest-api`:**
   - `package.json` — promoted 19 deps from server (otel, pino, observability, etc.)
   - `vite.config.ts` — SSR config with `noExternal`/`external` for drizzle/pino/otel
   - `tsconfig.json` — added refs for observability, embedding-service, bootstrap
   - New `Dockerfile` (no landing/design-system deps)
   - New `fly.toml` (reuses `app = "moltnet"`, `auto_stop_machines = "stop"`)
   - Moved E2E tests from server, updated `globalSetup.ts` for `rest-api` service name
   - New `vitest.config.e2e.ts`

3. **Landing page standalone deploy:**
   - New `apps/landing/fly.toml` (`app = "moltnet-landing"`, suspendable, 256MB)
   - Updated `Dockerfile` with `VITE_API_BASE_URL` build arg + asset caching headers
   - New `.github/workflows/deploy-landing.yml`

4. **CI/CD updates:**
   - `ci.yml`: build matrix `server` → `rest-api` + added `landing`; e2e uses `rest-api` image
   - `deploy.yml`: points to `apps/rest-api/Dockerfile` and `fly.toml`
   - `docker-compose.e2e.yaml`: `server` service → `rest-api`
   - `docker-compose.e2e.ci.yaml`: `SERVER_IMAGE` → `REST_API_IMAGE`

5. **Codebase cleanup:**
   - Removed `apps/server` from root `tsconfig.json`
   - Changed `dev:server` → `dev:api` in root `package.json`
   - Removed `@moltnet/server` from eslint boundary rules + server exception override
   - Updated mcp-server and landing Dockerfiles (removed server package.json COPY)
   - Updated `tools/src/check-secrets.ts` doc comment

6. **OpenAPI hosting:**
   - Generation now writes to `apps/rest-api/public/openapi.json` (served by API)
   - Removed `apps/landing/public/openapi.json` (landing fetches from API domain)
   - CI checks rest-api public openapi.json is up to date

7. **Deleted `apps/server/` entirely**

## Verification

- `pnpm run lint` — 0 errors
- `pnpm run typecheck` — all workspaces pass
- `pnpm run test` — all 178 rest-api tests + all packages pass
- `pnpm run build` — rest-api, mcp-server, landing, all libs build
- `docker build -f apps/rest-api/Dockerfile .` — succeeds
- `docker build -f apps/landing/Dockerfile .` — succeeds
- No stale `apps/server` or `@moltnet/server` references (outside journal)

## Decisions

- Kept `app = "moltnet"` in rest-api fly.toml to avoid recreating the Fly app
- Changed `auto_stop_machines` from `"suspend"` to `"stop"` for API (SSE connections)
- Landing gets `min_machines_running = 0` (fully suspendable)
- OpenAPI spec served from API domain, not landing

## What's not done

- DNS configuration (manual): `themolt.net` → `moltnet-landing.fly.dev`, `api.themolt.net` → `moltnet.fly.dev`
- Create `moltnet-landing` Fly app (manual: `flyctl apps create moltnet-landing`)
- E2E tests not run locally (require full Docker Compose stack)
- Landing page may need code updates to fetch OpenAPI from `api.themolt.net` instead of relative path

## Where to start next

1. Merge this PR
2. Create the `moltnet-landing` Fly app on Fly.io
3. Configure DNS for `themolt.net` → landing, `api.themolt.net` → API
4. Verify E2E tests pass in CI with the new docker-compose config
