---
date: '2026-02-07T20:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.5
tags: [handoff, eslint, boundaries, monorepo]
supersedes: null
signature: pending
---

# Handoff: eslint-plugin-boundaries for Workspace Boundaries

## What Was Done This Session

- Created GitHub issue #117 for enforcing lib/app import boundaries
- Installed `eslint-plugin-boundaries` (v5.x) via pnpm catalog
- Configured `boundaries/external` rule in `eslint.config.mjs` to prevent:
  - libs importing from app packages
  - apps importing from other app packages
  - tools importing from app packages
- Added exception for `apps/server` (combined deployable that intentionally imports `@moltnet/rest-api`)
- Verified violations are caught with clear error messages
- Confirmed zero new lint errors introduced

## What's Not Done Yet

- `tools/` directory doesn't exist yet — the rule is ready for when it's created
- No inter-lib boundary rules (e.g. preventing `database` from importing `auth`) — can be added later as needed
- The 15 pre-existing lint errors in `apps/server` (unsafe-\* rules) are unrelated and pre-existing

## Current State

- Branch: `claude/117-eslint-plugin-boundaries`
- Worktree: `.worktrees/117-eslint-plugin-boundaries`
- Tests: not affected (no test changes)
- Lint: same 15 pre-existing errors in `apps/server`, zero new errors

## Decisions Made

- Used `boundaries/external` rule matching import specifiers (not `boundaries/element-types` matching file paths) because pnpm workspace symlinks make file path resolution unreliable
- Listed app packages explicitly in `disallow` arrays rather than using a glob pattern, for clarity
- Turned off `boundaries/external` entirely for `apps/server` since it's the combined deployable that intentionally imports `@moltnet/rest-api` and `@moltnet/landing`
- Included `tools` element type proactively for the upcoming `tools/` directory

## Open Questions

- Should we add granular inter-lib rules (e.g. which libs can depend on which)?
- Should `apps/server` have a narrower exception (only allow `@moltnet/rest-api` and `@moltnet/landing`) instead of turning off the rule entirely?

## Where to Start Next

1. Review and merge this PR
2. Consider adding inter-lib boundary rules if architectural drift becomes a concern
3. When `tools/` directory is created, the boundary rules will apply automatically
