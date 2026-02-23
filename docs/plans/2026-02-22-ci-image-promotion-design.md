# CI Image Promotion Design

**Issue:** #283
**Date:** 2026-02-22
**Status:** Approved

## Problem

Two issues with the current deployment setup:

1. **No GitHub Environment** — no deployment tracking, no environment-scoped secrets
2. **Images rebuilt on deploy** — CI builds and E2E-validates `ci-<sha>` images, but deploy workflows rebuild from source independently. The deployed image is not the image that passed tests.

## Goal

Replace the rebuild-on-deploy pattern with image promotion — deploy the exact `ci-<sha>` image that CI built and validated. Add `environment: production` to all deploy jobs for tracking.

## Current State

- `ci.yml` `build-and-push` job builds `ci-<sha>` tagged images for all services
- Deploy workflows (`deploy.yml`, `deploy-mcp.yml`, `deploy-landing.yml`) trigger on `push` to `main` with path filters, rebuild from source via `_deploy.yml`'s `build` job
- No `latest` tags exist in GHCR — only `ci-<sha>` tags
- No `environment: production` on any deploy job
- `deploy-ory.yml` triggers directly on `push infra/ory/**`

## Deployment Sequence After Change

```
push to main
    └─► CI (lint, typecheck, test, build ci-<sha> images, E2E)
            └─► Deploy API    ──┐
            └─► Deploy MCP      ├─ parallel (workflow_run on CI success)
            └─► Deploy Landing ─┘
                    └─► Deploy Ory  (workflow_run on Deploy API success)
```

## Design

### `_deploy.yml` — replace `build` with `promote`

Replace the `build` job (rebuilds from source) with a `promote` job:

**New inputs:**

- `ci-image-name` (string, required) — name of the CI-built image (`rest-api`, `mcp-server`, `landing`)
- `head-sha` (string, **optional**, default `''`) — commit SHA to promote
- Remove `dockerfile` (no longer used)

**Promote logic (single job, conditional on sha):**

- **If `head-sha` is provided:**
  1. Validate `ci-<sha>` image exists via `docker buildx imagetools inspect` (fail fast if not found)
  2. Promote via `docker buildx imagetools create` (manifest copy — no layer transfer):
     - `GHCR/<ci-image-name>:ci-<sha>` → `GHCR/<image-name>:latest`
     - `GHCR/<ci-image-name>:ci-<sha>` → `GHCR/<image-name>:<sha>`
     - `GHCR/<ci-image-name>:ci-<sha>` → `Fly/<fly-app>:latest`
     - `GHCR/<ci-image-name>:ci-<sha>` → `Fly/<fly-app>:<sha>`
  3. Output `image_ref = registry.fly.io/<fly-app>:<sha>`

- **If `head-sha` is empty (workflow_dispatch without SHA):**
  1. Use `GHCR/<image-name>:latest` as source (last successfully promoted image)
  2. Validate it exists via `docker buildx imagetools inspect` (fail with clear message if not — means no prior deploy ran)
  3. Retag: `GHCR/<image-name>:latest` → `Fly/<fly-app>:latest`
  4. Output `image_ref = registry.fly.io/<fly-app>:latest`

**Deploy job:**

- `environment: production`
- `flyctl deploy --image ${{ needs.promote.outputs.image_ref }}`

### SHA resolution in callers

```
${{ github.event.inputs.sha || github.event.workflow_run.head_sha || '' }}
```

### `deploy.yml` (REST API)

- Trigger: `workflow_run` on CI (completed, main) + `workflow_dispatch`
- Remove `paths:` filter (not supported by `workflow_run`)
- `preflight` runs when: `workflow_run` succeeded OR `workflow_dispatch` (always, regardless of SHA)
- `deploy` calls `_deploy.yml` with `ci-image-name: rest-api`

### `deploy-mcp.yml` (MCP Server)

Same pattern as `deploy.yml`:

- `ci-image-name: mcp-server`
- Preflight uses `FLY_MCP_TOKEN` and `-a moltnet-mcp`

### `deploy-landing.yml` (Landing)

Same pattern, no preflight:

- `ci-image-name: landing`
- Secret: `FLY_LANDING_TOKEN`

### `deploy-ory.yml` (Ory Network)

- Trigger: `workflow_run` on **Deploy API** (completed, main) + `workflow_dispatch`
- `environment: production`
- Checkout at `${{ github.event.workflow_run.head_sha || github.sha }}` to deploy config at same commit as API

## Trade-offs

| Concern                                          | Decision                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `workflow_run` drops `paths:` filters            | Accepted — promote is cheap (manifest copy, no layer transfer), always deploying is fine                |
| First deploy needs explicit SHA                  | Accepted — first `workflow_run` creates `latest`; `workflow_dispatch` without SHA fails fast until then |
| `workflow_dispatch` without SHA deploys `latest` | Accepted — convenient for rollback recovery; user is responsible                                        |

## Out of Scope

- Protection rules / required reviewers on the environment
- Staging environment
- OIDC / keyless Fly.io auth
- Path-based deploy filtering
