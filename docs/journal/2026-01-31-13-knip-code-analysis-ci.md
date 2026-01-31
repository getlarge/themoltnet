---
date: '2026-01-31T20:00:00Z'
author: claude-opus-4-5-20251101
session: session_01XzXiYtDrf2L9DmU5gVnKtQ
type: handoff
importance: 0.6
tags: [handoff, ci, knip, code-analysis, audit]
supersedes: null
signature: pending
---

# Handoff: Knip Code Analysis and pnpm Audit in CI

## What Was Done This Session

- Set up Knip for pnpm workspaces with a workspace-aware config (`knip.config.ts`)
- Added `pnpm audit` for dependency vulnerability scanning
- Added two new CI jobs: `Code Analysis (Knip)` and `Dependency Audit`
- Both jobs produce JSON artifacts (30-day retention) for agents and builders
- Added root scripts: `pnpm run knip`, `pnpm run knip:fix`, `pnpm run audit`
- Knip added to pnpm catalog at `^5.82.1`

## What's Not Done Yet

- Pre-existing Knip findings need to be reviewed and addressed (7 unused deps, 2 unused devDeps, 1 unused exported type)
- Knip is non-blocking in CI — once findings are resolved, add `code-analysis` as a required status check
- Semgrep OSS could be added later for security-focused static analysis (free CLI, SARIF upload to GitHub Security tab)

## Current State

- Branch: `claude/add-code-analysis-ci-MlYDV`
- Build: clean
- Knip: finds 10 pre-existing issues (all genuine, not introduced by this change)
- Audit: clean (no known vulnerabilities)

## Decisions Made

- Knip is non-blocking (warning only) since there are pre-existing findings — avoids blocking all PRs immediately
- Audit blocks only on high/critical CVEs — security gate should be strict
- Both jobs upload JSON artifacts so agents can fetch and parse them via `gh run download`
- Minimal Knip config — only overrides what Knip can't auto-detect from package.json exports and vitest/vite plugins

## Open Questions

- Should the pre-existing Knip findings be fixed now or left for the next agent?
- Some "unused" OTel dependencies in observability may be needed at runtime via SDK auto-instrumentation — needs verification
- `pino-pretty` is likely used as a runtime transport (loaded by string name), not imported — may need `ignoreDependencies`

## Where to Start Next

1. Review `pnpm run knip` output and fix or suppress each finding
2. Once clean, add `code-analysis` as a required check in branch protection
3. Consider adding Semgrep OSS for security analysis (free, outputs SARIF)
