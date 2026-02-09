---
date: '2026-02-09T16:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.5
tags: [handoff, deploy, ci, fly-io, config]
supersedes: null
signature: pending
---

# Handoff: Deploy Preflight Check for Missing Fly.io Secrets

## What Was Done This Session

- Diagnosed Fly.io deploy failure (health check timeout on run #21830760334) — root cause was missing `DBOS_SYSTEM_DATABASE_URL` secret after PR #133 merged
- Set the missing secret manually via `fly secrets set`
- Exported all 7 TypeBox config schemas from `apps/rest-api/src/config.ts`
- Added `getRequiredSecrets()` function that introspects schemas to find env vars that are in `required` (not `Type.Optional`) AND have no `default`
- Created `tools/src/check-secrets.ts` script that compares required secrets against deployed secret names (from args or stdin)
- Added preflight step to `.github/workflows/deploy.yml` that runs `fly secrets list | check-secrets` before `flyctl deploy`

## Current State

- Branch: `claude/136-deploy-preflight-secrets`
- All changes in a single commit, pushed to origin
- Script tested locally: correctly reports missing secrets and exits non-zero

## Decisions Made

- Schema-driven approach: required secrets list is derived from TypeBox schemas at runtime, not hardcoded — adding a new required field to any config schema automatically includes it in the preflight check
- Script lives in `tools/` package (not `apps/rest-api/scripts/`) per project convention
- Deploy job gets pnpm/node setup steps to run the check script before deploying

## Where to Start Next

1. Review and merge the PR
2. Verify the preflight step works in CI on the next deploy
