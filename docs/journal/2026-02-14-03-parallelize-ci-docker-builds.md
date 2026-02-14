---
date: '2026-02-14T20:00:00Z'
author: claude-opus-4-6
session: parallelize-ci-docker-builds
type: handoff
importance: 0.6
tags: [handoff, ci, docker, performance]
supersedes: null
signature: pending
---

# Handoff: Parallelize Docker Image Builds in CI

## What Was Done This Session

- Restructured CI pipeline to build Docker images in parallel with quality checks
- Replaced the `build` job (which waited for lint/typecheck/test) with `build-and-push` (no `needs` — starts immediately)
- `build-and-push` builds 3 Docker images and pushes to GHCR with `ci-<sha>` tags:
  - `ghcr.io/getlarge/moltnet-server`
  - `ghcr.io/getlarge/moltnet-mcp-server`
  - `ghcr.io/getlarge/moltnet-db-migrate`
- Updated `e2e` job to `needs: [lint, typecheck, test, build-and-push]` and pull pre-built images
- Created `docker-compose.e2e.ci.yaml` override file using `!reset` YAML tag to replace `build:` with `image:` directives
- Updated both `apps/server/e2e/globalSetup.ts` and `apps/mcp-server/e2e/globalSetup.ts` with CI-aware compose file selection

## Key Decisions

- **`!reset` YAML tag**: Used Docker Compose Specification's `!reset null` to clear `build:` directives in the override file. This requires Compose v2.24.0+ (available on ubuntu-24.04 runners).
- **Scoped GHA cache**: Each Docker build uses a scoped cache key (`scope=server`, `scope=mcp-server`, `scope=db-migrate`) to avoid cache collisions within the same job.
- **Always push to GHCR**: Even on PRs, images are pushed since e2e needs them. Fork PRs may fail on this step due to token permissions — acceptable tradeoff.
- **Environment variable propagation**: CI sets `SERVER_IMAGE`, `MCP_SERVER_IMAGE`, `DB_MIGRATE_IMAGE` as job-level env vars, which propagate through `execSync` to `docker compose`.

## Pipeline Shape (Before → After)

Before:

```
lint/typecheck/test → build → (done)
lint/typecheck/test → e2e   → (done)
```

After:

```
lint ──────────────┐
typecheck ─────────┤
test ──────────────┼──► e2e (pulls pre-built images)
build-and-push ────┘
```

Expected wall-clock time savings: ~3-5 minutes (Docker builds no longer wait for quality checks).

## Files Changed

- `.github/workflows/ci.yml` — replaced `build` with `build-and-push`, updated `e2e`
- `docker-compose.e2e.ci.yaml` — **new** compose override for CI
- `apps/server/e2e/globalSetup.ts` — CI-aware compose file selection
- `apps/mcp-server/e2e/globalSetup.ts` — same

## What's Next

- Verify CI run succeeds end-to-end (images pushed, e2e pulls and passes)
- Consider adding image cleanup policy for `ci-*` tags in GHCR to prevent storage bloat
- Local dev workflow is unchanged (no `CI` env var → uses `--build` as before)
