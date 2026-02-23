---
date: '2026-02-22T17:00:00Z'
author: claude-sonnet-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, ci, deploy, image-promotion, github-actions]
supersedes: null
signature: pending
---

# Handoff: CI Image Promotion — Build Once, Deploy the Tested Image

## What Was Done This Session

- Claimed issue #283 (ci: production GitHub environment + image promotion)
- Created worktree at `.worktrees/claude/ci-image-promotion` on branch `claude/ci-image-promotion`
- Confirmed `production` GitHub Environment already exists with all 6 secrets configured
- Confirmed no `latest` GHCR tags exist (only `ci-<sha>` tags from CI) — first deploy via `workflow_run` will create them
- Designed and wrote `docs/plans/2026-02-22-ci-image-promotion-design.md`
- Wrote `docs/plans/2026-02-22-ci-image-promotion-plan.md`
- Implemented all 5 workflow file changes:
  - `.github/workflows/_deploy.yml` — replaced `build` job with `promote` job using `docker buildx imagetools create` (manifest copy, no layer transfer), added `environment: production` on deploy job, `head-sha` optional with `latest` fallback
  - `.github/workflows/deploy.yml` — switched trigger from `push` to `workflow_run` on CI + `workflow_dispatch` with `sha` input
  - `.github/workflows/deploy-mcp.yml` — same pattern
  - `.github/workflows/deploy-landing.yml` — same pattern, no preflight
  - `.github/workflows/deploy-ory.yml` — chains off `Deploy API` via `workflow_run` instead of direct `push`, added `environment: production`

## What's Not Done Yet

- **Smoke-test** (Task 6 from the plan) — manual `workflow_dispatch` to verify the full flow works in CI. This requires merging to `main` or running from the branch. The first deploy will promote a `ci-<sha>` image and push `latest`; subsequent no-SHA dispatches will use that `latest`.
- Secrets migration from repo-level to environment-level is already done (user confirmed GitHub Environment is configured).

## Current State

- Branch: `claude/ci-image-promotion`
- Tests: 214 passing, 0 failing (no TypeScript changes, all pre-existing validation failures on main are unrelated to this branch)
- Build: not applicable (workflow YAML only)
- My changes: exclusively `.github/workflows/*.yml` and `docs/plans/`
- Pre-existing failures on `main` (unrelated): `check:pack` for `@themoltnet/cli` missing `dist/index.js`; `tools` typecheck needs apps built first

## Decisions Made

- **`latest` fallback for no-SHA `workflow_dispatch`**: Uses `GHCR/<image-name>:latest` as source (last successfully promoted image). Fails fast with a clear error if no prior deploy exists. The first deploy must have an explicit SHA (or be triggered by `workflow_run` after CI).
- **Preflight always runs on `workflow_dispatch`**: Regardless of whether `deploy` input is true or false, secrets are always verified.
- **Fly registry also gets `latest` tag**: During promotion, `registry.fly.io/<app>:latest` is tagged alongside `registry.fly.io/<app>:<sha>` so the no-SHA fallback can use it.
- **`github.repository` not hardcoded `IMAGE_OWNER`**: Uses `${{ github.repository }}` for the GHCR image path, making the workflow portable if the repo is ever renamed.
- **`deploy-ory.yml` triggers off Deploy API, not CI**: Ory config changes often depend on a new API being live first. Chaining ensures correct sequencing.

## Open Questions

- None blocking. The smoke-test is a validation step, not a blocker for the PR.

## Where to Start Next

1. Merge the PR (this branch)
2. After merge, trigger the first deploy manually: `gh workflow run deploy.yml --field sha=<latest-CI-sha> --field deploy=true`
3. Verify `environment: production` badge appears on the deploy run in GitHub Actions
4. After that first deploy, the no-SHA fallback path becomes available for `workflow_dispatch`
5. Optionally: test bad SHA fails fast by dispatching with `sha=0000...` and `deploy=false`
