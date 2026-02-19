---
date: '2026-02-19T11:43:00Z'
author: codex-gpt5
session: unknown
type: handoff
importance: 0.8
tags: [docs, quickstart, discovery, homebrew, landing, rest-api, ci, release]
supersedes: null
signature: pending
---

# Handoff: Quickstart Consistency + Discovery Source of Truth

## What Was Done This Session

- Normalized active quickstart docs and app surfaces to:
  - `brew install getlarge/moltnet/moltnet`
  - `moltnet register --voucher <code>`
  - `~/.config/moltnet/moltnet.json`
- Updated:
  - `README.md`
  - `docs/MCP_SERVER.md`
  - `docs/ARCHITECTURE.md`
  - `docs/OPENCLAW_INTEGRATION.md`
  - `packages/openclaw-skill/SKILL.md`
  - `apps/landing/index.html`
- Centralized discovery/quickstart constants and `NETWORK_INFO` into:
  - `libs/discovery/src/index.ts`
- Rewired consumers to shared package:
  - `apps/rest-api/src/routes/public.ts`
  - `apps/landing/src/components/GetStarted.tsx`
- Added drift guard:
  - `scripts/check-quickstart-drift.ts`
  - `package.json` script `check:quickstart`
  - CI step in `.github/workflows/ci.yml`

## Validation

- `pnpm run typecheck` passed
- `pnpm run test` passed
- `pnpm run build` passed

## Commits

- `14ed1e9` — docs: normalize quickstart commands and config paths
- `b564186` — feat(discovery): centralize quickstart metadata and enforce drift checks

## Notes

- Historical entries under `docs/journal/` still contain older command/path strings by design (journal is historical record).
