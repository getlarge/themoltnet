---
date: '2026-01-31T12:00:00Z'
author: claude-opus-4-5-20251101
session: session_01YP2rP5pf1LPxxkWQehFGQ7
type: progress
importance: 0.7
tags: [ci, eslint, prettier, husky, github-actions, safeguards]
supersedes: null
signature: pending
---

# Progress: CI Pipeline and Local Safeguards Established

## Context

MoltNet had no automated quality gates — no linting, no formatting enforcement, no CI pipeline. For a project intended to run autonomous agent infrastructure, every merge risked introducing silent regressions. Edouard requested safeguards that run continuously, both locally and in CI: lint, test, typecheck, build.

## Substance

### Local Safeguards

**ESLint** (`.eslintrc.json`):

- `@typescript-eslint/recommended` ruleset
- Unused variables error with `_` prefix exception
- `no-explicit-any` and `no-non-null-assertion` as warnings
- Ignores `dist/`, `node_modules/`, and `infra/ory/permissions.ts` (OPL DSL, not standard TypeScript)

**Prettier** (`.prettierrc.json`):

- Single quotes, trailing commas, 80 char width, 2-space indent, semicolons

**Husky + lint-staged** (pre-commit hook):

- On every commit, staged `.ts` files run through `eslint --fix` and `prettier --write`
- Staged `.json`, `.md`, `.yaml`, `.yml` files run through `prettier --write`
- Catches formatting and lint issues before they reach the remote

### CI Pipeline (`.github/workflows/ci.yml`)

Four jobs running on `ubuntu-latest` with Node 20:

1. **lint** — `npm ci && npm run lint`
2. **typecheck** — `npm ci && npm run typecheck`
3. **test** — `npm ci && npm test`
4. **build** — `npm ci && npm run build` (depends on lint + typecheck + test passing)

Triggers on push to `main` and PRs targeting `main`. Concurrency groups cancel stale runs.

### Monorepo Fixes Required

Several issues discovered and fixed during setup:

- **Root `tsconfig.json`** had `rootDir: "./src"` and `outDir: "./dist"` which broke cross-workspace `tsc --noEmit`. Removed — these are per-workspace concerns.
- **Three workspaces** (`crypto-service`, `database`, `models`) lacked their own `tsconfig.json`, causing build artifacts to land next to source files. Added per-workspace configs extending root.
- **`infra/ory/permissions.ts`** is Ory Permission Language (OPL) DSL, not standard TypeScript. Added to tsconfig `exclude` array.
- **Unused imports** in `libs/database/src/schema.ts` (`sql` from drizzle-orm) and `libs/observability/src/sdk.ts` (`trace` after refactor). Removed.
- **`vitest` exit code 1** on workspaces with no test files. Added `--passWithNoTests` flag to `crypto-service`, `database`, and `models` test scripts.

### Validation Script

Added `npm run validate` — runs `lint && typecheck && test && build` in sequence. Same checks as CI, runnable locally.

## Continuity Notes

- CI triggers on push to `main` and PRs to `main`. Feature branches only get CI coverage when a PR is opened.
- The pre-commit hook via husky runs automatically after `npm install` (the `prepare` script calls `husky`).
- 13 ESLint warnings remain — all `no-non-null-assertion` in test files and pre-existing code. These are intentional in test contexts.
- When adding new workspaces, remember to: (1) add a `tsconfig.json` extending root, (2) add `--passWithNoTests` if no tests exist yet, (3) add path alias in root tsconfig if needed.
