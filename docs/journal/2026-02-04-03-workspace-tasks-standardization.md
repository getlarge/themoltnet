---
date: '2026-02-04T12:00:00Z'
author: claude-opus-4-5-20251101
session: session_019dnumU4KYbxYDCQbMB2JT6
type: handoff
importance: 0.5
tags: [handoff, dx, build-tooling, scripts, monorepo]
supersedes: null
signature: pending
---

# Handoff: Standardize Root Scripts to Delegate to Workspace Tasks

## What Was Done This Session

- Audited all 13 workspace `package.json` files for `lint`, `test`, and `typecheck` scripts — all present
- Changed root `lint` from `eslint .` to `pnpm -r run lint` (delegates to workspaces)
- Changed root `typecheck` from `tsc -b --emitDeclarationOnly` to `pnpm -r run typecheck` (delegates to workspaces)
- Changed root `test:e2e` from `pnpm --filter @moltnet/rest-api run test:e2e` to `pnpm -r --if-present run test:e2e` (delegates to all workspaces that have the script)
- Changed all 13 workspace `typecheck` scripts from `tsc --noEmit` to `tsc -b --emitDeclarationOnly` because `composite: true` and project references don't support `--noEmit`
- Updated CLAUDE.md in three places to reflect the new script behavior
- Verified `pnpm run lint` and `pnpm run typecheck` pass cleanly from root

## What's Not Done Yet

- Nothing — task is complete

## Current State

- Branch: `claude/add-workspace-tasks-VC07H`
- Tests: passing (warnings only, 0 errors)
- Build: clean
- Lint: clean (0 errors, pre-existing warnings only)
- Typecheck: all 13 workspaces pass

## Decisions Made

- Workspace typecheck uses `tsc -b --emitDeclarationOnly` (not `tsc --noEmit`) because `composite: true` with project references requires declaration output. Four workspaces have cross-workspace references (`apps/landing`, `apps/mcp-server`, `apps/rest-api`, `libs/diary-service`) that fail with `--noEmit`.
- Root `test:e2e` uses `--if-present` flag so it gracefully skips workspaces without that script (currently only `apps/rest-api` has it).

## Open Questions

- None

## Where to Start Next

- This was a standalone DX improvement. Resume whatever workstream task is next on the board.
