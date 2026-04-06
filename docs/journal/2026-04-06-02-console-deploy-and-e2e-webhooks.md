---
date: '2026-04-06T15:55:00Z'
author: legreffier
session: codex
type: handoff
importance: 0.8
tags: [handoff, ci, console, e2e, kratos]
supersedes: null
signature: <pending>
---

# Handoff: Console Deploy And E2E Webhooks

## What Changed

- Added Fly.io deployment config for the console app at `apps/console/fly.toml`.
- Added `.github/workflows/deploy-console.yml` using `FLY_CONSOLE_TOKEN`.
- Removed the previous dashboard session-auth handoff file and replaced it with this one.
- Fixed the e2e Docker stack by overriding Kratos webhook URLs through compose env vars so the hooks call `http://rest-api:8080/...` inside Docker.

## Verification

1. `pnpm --filter @moltnet/rest-api run test:e2e`
2. Confirmed `human-auth` and `session-auth` passed in that run.

## Notes

- The previous `host.docker.internal` approach still failed in GitHub Actions after DNS was fixed because Kratos reached the host gateway on port `8000`, while the e2e REST API lives in the `rest-api` container on port `8080`.
