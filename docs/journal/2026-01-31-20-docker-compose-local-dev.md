---
date: '2026-01-31T19:10:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: progress
importance: 0.7
tags: [ws2, docker-compose, local-dev, ory, infrastructure]
supersedes: null
signature: pending
---

# Progress: Docker Compose Local Dev Environment

## Context

WS2 (Ory Config) needed a local development environment where self-hosted Ory services
replace the Ory Network cloud. This enables offline development, integration testing,
and CI pipelines without cloud dependencies. Tracked in GitHub issue #13 (Phase 5).

## What Was Done

### Docker Compose orchestration (`docker-compose.yaml`)

- 15 services across two profiles: `dev` (infra only) and `ci` (infra + apps)
- Infrastructure: app-db (pgvector:pg16), Kratos, Hydra, Keto (each with their own
  Postgres + migration job), OTel Collector, Mailslurper
- App containers: rest-api, mcp-server, landing (ci profile only)
- All Ory services have health checks and proper dependency ordering
- pgvector init.sql auto-loaded via docker-entrypoint-initdb.d

### Ory self-hosted configs

- `infra/ory/kratos/kratos.yaml` — translated from project.json cloud config
  - Identity schema loaded from volume-mounted file
  - SMTP routed to Mailslurper for email testing
  - Hydra integration via `oauth2_provider.url`
  - Password method with 16-char minimum, code method, session hook
- `infra/ory/hydra/hydra.yaml` — OAuth2 + DCR
  - JWT access token strategy (not opaque)
  - DCR enabled with MoltNet scopes (diary:read, diary:write, crypto:sign, agent:profile)
  - client_credentials default_grant_allowed_scope enabled
  - TTLs matching cloud config (access_token 1h, refresh_token 720h)
- `infra/ory/keto/keto.yaml` — permissions
  - Loads existing `permissions.ts` OPL from volume mount

### Dockerfiles (all 3 apps)

- Multi-stage builds: base → deps → build → production
- pnpm workspace-aware: copies all workspace package.json files for lockfile resolution
- `NPM_STRICT_SSL` build arg for proxy environments (defaults to true)
- rest-api and mcp-server: node:20-slim production stage
- landing: nginx:alpine production stage with SPA fallback
- All three verified with successful `docker build`

### Supporting files

- `.env.docker` — non-secret Docker env defaults (committed)
- `.dockerignore` — excludes node_modules, dist, docs, .git, secrets
- `.gitignore` — added `!.env.docker` allowlist
- `package.json` — added docker:up, docker:down, docker:reset, docker:logs scripts

## Key Decisions

1. **Separate Postgres per Ory service** — follows official Ory pattern, avoids schema collisions
2. **Direct YAML configs** (not envsubst templates) — local dev values hardcoded, cloud config stays in project.json
3. **`npm install -g pnpm`** instead of corepack — more reliable in Docker builds (corepack fetch fails behind proxies)
4. **`NPM_STRICT_SSL` build arg** — keeps Dockerfiles clean for production while allowing `--build-arg NPM_STRICT_SSL=false` for corporate proxy environments
5. **Profiles** — `dev` for infrastructure-only (apps run natively), `ci` for full containerization

## Build Test Results

| App        | Build                          | Image Size |
| ---------- | ------------------------------ | ---------- |
| rest-api   | tsc compiled cleanly           | 763 MB     |
| mcp-server | tsc compiled cleanly           | 763 MB     |
| landing    | vite built 55 modules in 552ms | 92 MB      |

## What's Not Done

- rest-api and mcp-server containers won't _run_ — their index.ts files export factory functions but lack a `main.ts` that calls `listen()`. Dockerfiles are ready for when entry points are added.
- Infra services not smoke-tested with `docker compose up` in this session (would need to pull ~10 images)
- DCR end-to-end flow not tested against self-hosted Hydra

## Continuity Notes

- The `libs/auth/src/ory-client.ts` currently uses a single `baseUrl` for Ory Network. For self-hosted, it needs separate URLs per service (KRATOS_PUBLIC_URL, HYDRA_PUBLIC_URL, etc.). This is a code change for the auth library task.
- Ory config YAML formats differ from the project.json cloud format — they're not interchangeable. Cloud deploys continue using `infra/ory/deploy.sh` + `project.json`.
