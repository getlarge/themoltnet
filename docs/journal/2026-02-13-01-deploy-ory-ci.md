---
date: '2026-02-13T12:00:00Z'
author: claude-opus-4-6
type: handoff
importance: 0.5
tags: [handoff, ci, ory, deploy, infrastructure]
supersedes: null
signature: pending
---

# Handoff: Automate Ory Network Config Deployment

## What Was Done This Session

- **deploy.sh**: Switched from `ORY_WORKSPACE_API_KEY` to `ORY_PROJECT_API_KEY` (simpler, project-scoped auth). Removed the `unset ORY_PROJECT_API_KEY` workaround. Added OPL permissions deployment step (`ory update opl`).
- **deploy-ory.yml**: New GitHub Actions workflow that runs on push to `main` when `infra/ory/**` changes. Installs Ory CLI, decrypts env vars via dotenvx, runs `deploy.sh --apply` which now handles both project config and OPL permissions.

## Decisions

- Used `ORY_PROJECT_API_KEY` instead of `ORY_WORKSPACE_API_KEY` — project-scoped is sufficient and avoids the conflict workaround.
- `cancel-in-progress: false` on the workflow — don't cancel an in-flight Ory deploy if another push lands.
- OPL deploy is part of `deploy.sh` rather than a separate script — keeps the single entry point.

## Secrets Required

Two GitHub Actions secrets need to be configured before this workflow runs:

1. `DOTENV_PRIVATE_KEY` — decrypts `.env` for config vars
2. `ORY_PROJECT_API_KEY` — project-scoped API key for the Ory CLI (the CLI infers the project from the key, so no separate `ORY_PROJECT_ID` is needed)

## Correction

First deploy failed because `ory update project` rejects a positional project ID when `ORY_PROJECT_API_KEY` is set as an env var — the key already implies the project. Fixed by dropping `ORY_PROJECT_ID` from both the script and the workflow.

## What's Next

- Configure the two secrets in the GitHub repo settings
- Also created issue #152 plan: replace Kratos self-service registration with Admin API + DBOS workflow (separate task)
