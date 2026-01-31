---
date: '2026-01-31T10:40:00Z'
author: claude-opus-4-5-20251101
session: migrate-pnpm-catalogs-FpLa0
type: handoff
importance: 0.7
tags: [pnpm, catalogs, monorepo, infrastructure, migration]
supersedes: null
signature: <pending>
---

# Migrated from npm to pnpm with Catalogs for Version Policy

## Context

Migrated the MoltNet monorepo from npm workspaces to pnpm workspaces with the catalog protocol to enforce a single version policy across all packages.

## Substance

### What was done

1. **Created `pnpm-workspace.yaml`** with workspace patterns (`apps/*`, `libs/*`) and a default catalog containing all 40+ dependencies across the monorepo. The catalog is the single source of truth for version ranges.

2. **Updated all 6 `package.json` files** (root + 5 workspace packages) to use `catalog:` protocol for every dependency. Version ranges are no longer scattered across individual packages.

3. **Updated root `package.json`**:
   - Added `"packageManager": "pnpm@10.28.1"` for corepack
   - Replaced all `npm run --workspace` scripts with `pnpm --filter` / `pnpm -r` equivalents
   - Added `pnpm.onlyBuiltDependencies` for esbuild and protobufjs
   - Removed `"workspaces"` field (pnpm uses `pnpm-workspace.yaml` instead)

4. **Created `.npmrc`** with `enable-pre-post-scripts=true` for husky's `prepare` script.

5. **Updated CI workflow** (`.github/workflows/ci.yml`):
   - Switched from `actions/setup-node` with `cache: npm` to `pnpm/action-setup@v4` + `cache: pnpm`
   - Replaced `npm ci` with `pnpm install --frozen-lockfile`
   - Bumped CI node version from 20 to 22

6. **Updated `.husky/pre-commit`** from `npx` to `pnpm exec`.

7. **Updated `CLAUDE.md`** documentation with all pnpm commands, catalog workflow for new workspaces, and updated repo structure.

### Catalog structure

All dependencies are in the default catalog (referenced via `catalog:` with no name). This includes:

- Build tooling (typescript, tsx, vite)
- Testing (vitest)
- Linting (eslint, prettier, @typescript-eslint)
- React ecosystem (react, react-dom, @types/react)
- Fastify ecosystem (fastify, fastify-plugin, @fastify/otel)
- Database (drizzle-orm, drizzle-kit, postgres, pgvector)
- OpenTelemetry (13 packages, all version-aligned)
- Observability (pino, pino-pretty)
- Domain-specific (@noble/ed25519, @sinclair/typebox)

### Design decision: peerDependencies

The design-system's `peerDependencies` for React (`^18.0.0 || ^19.0.0`) was left as a literal range rather than using `catalog:` since the peer dep range intentionally differs from the catalog's dev version (`^19.0.0`).

### Verification

All checks pass:

- `pnpm run lint` — 0 errors, 13 warnings (pre-existing)
- `pnpm run typecheck` — clean
- `pnpm run test` — 50 tests passing across 6 suites
- `pnpm run build` — all 5 workspace packages build successfully

## Continuity Notes

- The `package-lock.json` has been removed; `pnpm-lock.yaml` is the new lockfile
- To add a dependency, first add the version to the catalog in `pnpm-workspace.yaml`, then use `catalog:` in the package's `package.json`
- pnpm 10 requires explicit build script approval — new native dependencies may need to be added to `pnpm.onlyBuiltDependencies` in root `package.json`
- The `pnpm/action-setup@v4` action reads the `packageManager` field from `package.json` to determine which pnpm version to install
