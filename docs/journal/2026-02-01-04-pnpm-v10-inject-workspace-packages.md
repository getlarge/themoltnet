---
date: '2026-02-01T21:30:00Z'
author: claude-opus-4-5-20251101
session: session_01P7KKcFsP4RgmbP4jMen9j6
type: handoff
importance: 0.7
tags:
  [
    handoff,
    pnpm,
    inject-workspace-packages,
    typescript,
    project-references,
    docker,
    deployment,
  ]
supersedes: null
signature: pending
---

# Handoff: pnpm v10 inject-workspace-packages + TypeScript Project References

## What Was Done This Session

- Fixed Docker deploy failure: `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` in `apps/server/Dockerfile`
- Set `inject-workspace-packages=true` in `.npmrc` (pnpm v10 recommended approach)
- Reverted `--legacy` flag from Dockerfile deploy command
- Added `composite: true` to all 13 workspace tsconfigs
- Added `references` for packages with `workspace:*` deps (diary-service, rest-api, mcp-server, landing)
- Converted root `tsconfig.json` to solution-style (`files: []` + `references` array)
- Changed `typecheck` script from `tsc --noEmit` to `tsc -b --emitDeclarationOnly`
- Updated CLAUDE.md: TypeScript config rules, new workspace checklist, CI pipeline description

## Correction to Previous Entry

Journal entry `2026-01-31-15-tsconfig-project-references.md` states `tsc -b --noEmit` works for type-checking. This is **not true with TypeScript 5.9** when projects reference each other — TS6310 error: "Referenced project may not disable emit." The correct command is `tsc -b --emitDeclarationOnly`, which emits only `.d.ts` + `.tsbuildinfo` (no `.js`). See [TypeScript issue #53979](https://github.com/microsoft/TypeScript/issues/53979).

## What's Not Done Yet

- The previous entry's three-layer architecture (`tsconfig.base.json` separate from solution `tsconfig.json`) was not implemented. The current setup uses a single root `tsconfig.json` that serves as both base config (via `extends`) and solution file (via `references`). This is simpler and works fine.
- `syncInjectedDepsAfterScripts` not configured — unnecessary because all packages export source (`./src/index.ts`), not dist. Source files don't change during builds, so hard-link staleness is a non-issue.

## Current State

- Branch: `claude/fix-pnpm-deploy-Typjo`
- Tests: 362 passing, 0 failing
- Build: clean from scratch (dist removed, typecheck + build pass)
- Lint: 0 errors, 28 pre-existing warnings

## Decisions Made

- **`inject-workspace-packages=true` over `--legacy`**: The `--legacy` flag is a deprecated escape hatch. The modern approach is the pnpm v10 default. With `dedupeInjectedDeps` (default true), pnpm still uses symlinks when there are no peer dep conflicts, so local dev workflow is minimally affected.
- **`tsc -b --emitDeclarationOnly` over `tsc --noEmit`**: `--noEmit` is unsupported with project references (TS needs `.d.ts` files from deps to resolve types). `--emitDeclarationOnly` is the minimal emit: `.d.ts` + `.tsbuildinfo` go to gitignored `dist/`, no `.js` output.
- **No changes to package.json exports or Vite config**: Source-based exports (`./src/index.ts`) are ideal for injected packages. Vite resolves independently.

## Open Questions

- Should `syncInjectedDepsAfterScripts: ["build"]` be added to `.npmrc` as a safety net? Currently unnecessary but could help if packages ever switch to dist-based exports.
- The previous entry suggested `tsconfig.base.json` + solution `tsconfig.json` separation. Worth doing if the project grows, but current single-file approach works.

## Where to Start Next

1. The Docker deploy should now work — verify in CI
2. Consider the `www.themolt.net` redirect question from previous handoff
3. WS7 Phase 2: mount REST API under `/api/v1/`, add observability
