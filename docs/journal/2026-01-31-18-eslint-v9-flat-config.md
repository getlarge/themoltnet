---
date: '2026-01-31T14:30:00Z'
author: claude-opus-4-5-20251101
session: session_01QMEVW85KsU1t7fUg6QhGPw
type: handoff
importance: 0.7
tags: [handoff, eslint, flat-config, code-quality, knip]
supersedes: null
signature: pending
---

# Handoff: ESLint v9 Flat Config Migration & Code Quality Fixes

## What Was Done This Session

- Migrated ESLint from v8 (`.eslintrc.json` + `.eslintignore`) to v9 flat config (`eslint.config.mjs`)
- Upgraded `eslint` from `^8.56.0` to `^9.0.0`
- Replaced `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` (v6) with unified `typescript-eslint` v8
- Added `@eslint/js` package for ESLint recommended rules
- Translated all rules from main's `.eslintrc.json` (including PR #15 additions) into flat config format:
  - `simple-import-sort` plugin for import/export ordering
  - `react-hooks` plugin for TSX files
  - Type-checked rules for source files (`recommendedTypeChecked`, `projectService`)
  - Relaxed `unsafe-*` rules for observability, models, and landing packages
  - Test files exempt from `no-explicit-any` and `no-non-null-assertion`
- Removed 5 unused OpenTelemetry dependencies from `@moltnet/observability`
- Removed unused exports and types from `rest-api/schemas.ts` and `mcp-server/helpers.ts`
- Fixed all 68 original lint warnings (`any` → `unknown`, non-null assertions → proper null checks)
- Resolved rebase conflicts with main (after PR #15 merged)

## What's Not Done Yet

- 12 remaining lint warnings (all `require-await` on Fastify plugin functions and one `no-console`) — these are intentional warnings, not errors
- `eslint-plugin-react-hooks` and `eslint-plugin-simple-import-sort` are pinned directly in `package.json` rather than using catalog protocol (could be moved to catalog)

## Current State

- Branch: `claude/fix-issue-14-KgkdE`
- Lint: 0 errors, 12 warnings (all `require-await` on async Fastify plugins)
- Typecheck: clean
- Tests: all passing
- Build: clean
- Knip: zero findings

## Decisions Made

- Used `eslint.config.mjs` (ESM) rather than `eslint.config.js` (CJS) since the project uses ES modules
- Used `projectService: true` in `languageOptions.parserOptions` instead of `project: true` — this is the recommended approach for typescript-eslint v8 with ESLint 9
- Kept `@typescript-eslint/no-empty-object-type` as `off` — this new rule in typescript-eslint v8 flags `{}` types in TypeBox schema definitions which are intentional

## Where to Start Next

1. The branch is ready for PR review and merge
2. The 12 remaining `require-await` warnings could be addressed by removing `async` from Fastify plugin registration functions (they don't use `await` but Fastify's type system expects async functions)
3. The ESLint plugin packages could be moved to the pnpm catalog for consistency
