---
date: '2026-02-06T08:00:00Z'
author: claude-opus-4-6
session: 01U8c4jw6gRNKiU1KQJX9PZF
type: handoff
importance: 0.7
tags: [build, vite, typescript, pnpm, project-references, ssr]
supersedes: 2026-02-01-04-pnpm-v10-inject-workspace-packages.md
signature: pending
---

# Handoff: pnpm + TypeScript Project References + Vite SSR Builds

## Context

Investigated the best way to configure pnpm with TypeScript project references (prompted by pnpm/pnpm#9837). The goal was proper incremental builds, correct build ordering, and production-ready bundled output for deployable apps.

## What Was Done

### Genuinely useful changes

1. **`tsc -b` for libs** — Changed all lib `build` scripts from `tsc` to `tsc -b` for incremental compilation with `.tsbuildinfo` caching. This respects project references and builds in dependency order.

2. **`update-ts-references`** — Added to postinstall. Auto-syncs tsconfig `references` from `workspace:*` dependencies so they never drift.

3. **`inject-workspace-packages=false`** — Changed from pnpm v10 default (`true`, hardlinked copies) to `false` (symlinks). Changes propagate instantly without re-running `pnpm install`.

4. **Vite SSR builds for apps** — Added `vite.config.ts` with `build.ssr: 'src/index.ts'` to server, rest-api, and mcp-server. Vite's SSR mode bundles workspace deps inline (follows symlinks) while externalizing third-party node_modules. Result: `node dist/index.js` works with only third-party deps in node_modules.

5. **Simplified root build** — Changed from `tsc -b && pnpm --filter @moltnet/landing build` to `pnpm -r run build`. pnpm runs topologically: libs (`tsc -b`) first, then apps (`vite build`).

### What was tried and reverted

- **`@moltnet/source` custom export condition** — Added to all package.json exports + `customConditions` in root tsconfig. Discovered that Vite 6's `resolve.conditions` does NOT work for custom condition names in `resolvePackageEntry`. Tested both `@moltnet/source` and plain `source` — both fail. Reverted: the `import` condition already points to source, making custom conditions cosmetic with no real effect.

- **Exports pointing to dist** — Briefly changed `import` condition to `./dist/index.js`. Since all packages are private and source-direct works everywhere (TypeScript, Vite, vitest, tsx), there's no reason to point exports to dist.

## Key Learnings

1. **Vite SSR externalization is smart** — Workspace packages resolved via symlinks are detected as "internal" and bundled. `node_modules/` packages are detected as "external" and left as runtime imports. No configuration needed.

2. **Vite 6 `resolve.conditions` is broken for SSR** — Custom conditions in `resolve.conditions` are not passed to `resolvePackageEntry`. The Vite 6 release notes mention `defaultClientConditions` / `defaultServerConditions` but these don't fix the issue for custom condition names.

3. **Source-direct exports just work** — `"import": "./src/index.ts"` is resolved by TypeScript (`moduleResolution: "bundler"`), Vite, vitest, and tsx. No custom conditions needed for a private monorepo.

4. **`@fastify/vite` team warns against bundling Fastify** — They say Fastify doesn't need Vite's frontend-optimized build. In practice, Vite SSR build works fine for Fastify apps since it's just esbuild+Rollup without any frontend transforms.

## Build Architecture Now

| Package type                        | Build tool         | Output                           | What happens                                 |
| ----------------------------------- | ------------------ | -------------------------------- | -------------------------------------------- |
| Libs                                | `tsc -b`           | `.d.ts` + `.js` + `.tsbuildinfo` | Declarations for consumers                   |
| Apps (server, rest-api, mcp-server) | `vite build` (SSR) | Single bundled `dist/index.js`   | Workspace deps inlined, third-party external |
| Landing                             | `vite build`       | Static site in `dist/`           | Client-side React SPA                        |

## Bundle Sizes

| App        | Modules bundled | Size      |
| ---------- | --------------- | --------- |
| server     | 3               | 3.03 KB   |
| mcp-server | 22              | 46.06 KB  |
| rest-api   | 146             | 511.82 KB |

## What's Next

- **Docker story** — The Dockerfile (`apps/server/Dockerfile`) still uses `pnpm deploy --prod` which may need `--legacy` flag with `inject-workspace-packages=false`. Since workspace deps are now bundled by Vite, `pnpm deploy` only needs to provide third-party node_modules. Worth testing.
- **rest-api and mcp-server lack runnable entry points** — Their `src/index.ts` only export factory functions, no `main()`. The `start` scripts (`node dist/index.js`) would import/execute the module but not start a server. Consider adding standalone runners if these should be independently deployable.
- **Combined server** — `apps/server` currently only serves static files. It should eventually import `@moltnet/rest-api` to serve both landing page and API from one process.

## Continuity Notes

- Branch: `claude/pnpm-typescript-references-kq52D`
- All validation passes: typecheck, lint (0 errors), 409 tests, full build
- The `ts-references.md` memory file referenced in earlier journal entries no longer exists; relevant info is in `/root/.claude/projects/-home-user-themoltnet/memory/MEMORY.md`
