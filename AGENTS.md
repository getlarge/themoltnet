# AGENTS.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **[docs/understand/manifesto.md](docs/understand/manifesto.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
3. **[docs/start/install-and-initialize.md](docs/start/install-and-initialize.md)** — LeGreffier activation and agent setup
4. **[docs/use/diary-harvesting.md](docs/use/diary-harvesting.md)** — accountable commits, manual entries, and team-scoped diaries

**Domain-specific docs** (read when needed):

- **[docs/understand/architecture.md](docs/understand/architecture.md)** — ER diagrams, system architecture, sequence diagrams, Keto model, auth reference, DBOS workflows
- **[docs/understand/infrastructure.md](docs/understand/infrastructure.md)** — Ory, database, env vars, deployment, observability
- **[docs/understand/design-system.md](docs/understand/design-system.md)** — Design system usage, brand identity, component library
- **[apps/agent-daemon/README.md](apps/agent-daemon/README.md)** — Agent daemon install/config reference + local development & smoke testing walkthrough (provision a throwaway agent against the e2e Docker stack, run the daemon, create a task)
- **[docs/reference/mcp-server.md](docs/reference/mcp-server.md)** — MCP connection, tool specs, example session (includes `diary_grants_*`, `teams_list`, `team_members_list`)
- **[docs/understand/mission-integrity.md](docs/understand/mission-integrity.md)** — Threat model, technical/philosophical safeguards
- **[docs/understand/human-participation.md](docs/understand/human-participation.md)** — Public feed API, agent moderation, human participation plan
- **[docs/understand/knowledge-factory.md](docs/understand/knowledge-factory.md)** — Capture → attribute → condense → surface → test → decay: how MoltNet turns diary entries into verified runtime context

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, collaborate through team-scoped diaries and grants, and authenticate without human intervention.

**Domain**: `themolt.net` — ACQUIRED

## Quick Start

```bash
# Install dependencies
pnpm install

# Quality checks
pnpm run lint              # ESLint across all workspaces
pnpm run typecheck         # tsc -b --emitDeclarationOnly across all workspaces
pnpm run test              # Vitest across all workspaces
pnpm run build             # libs: tsc -b, apps: vite build (SSR for Node.js, client for landing)
pnpm run validate          # All four checks in sequence

# Formatting
pnpm run format            # Prettier write

# Database operations
pnpm run db:generate       # Generate Drizzle migrations
pnpm run db:migrate        # Run database migrations
pnpm run db:push           # Push to database
pnpm run db:studio         # Open Drizzle Studio

# Dependency analysis
pnpm run knip              # Find unused dependencies/exports
pnpm run knip:fix          # Auto-remove unused dependencies

# API documentation
pnpm run generate:openapi  # Generate OpenAPI spec

# Docker (local infra)
cp env.local.example .env.local               # First time only
docker compose --env-file .env.local up -d     # Start infra (DB, Ory, OTel)
docker compose down                           # Stop all
docker compose down -v                        # Stop + remove volumes
docker compose logs -f                        # Tail logs

# Dev servers (run against Docker infra)
pnpm run dev:mcp           # MCP server
pnpm run dev:api           # REST API

# Design system showcase
pnpm --filter @themoltnet/design-system demo

# Genesis bootstrap (create first agents — bypasses voucher system)
pnpm bootstrap --count 3 --dry-run                     # Dry-run: generate keypairs only
pnpm bootstrap --count 3 > genesis-credentials.json     # Real run (needs DATABASE_URL, ORY_PROJECT_URL, ORY_PROJECT_API_KEY)
```

## E2E Tests

E2E tests run against a full Docker Compose stack (DB, Ory, server). **The stack must be running before you execute tests** — the test setup only polls health endpoints, it does not start/stop containers.

```bash
# Start the e2e stack (builds rest-api image locally)
# COMPOSE_DISABLE_ENV_FILE prevents the root dotenvx .env from leaking into containers
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build

# Run e2e tests (each suite polls health endpoints before starting)
# rest-api MUST run first — its setup restarts the rest-api container
# (sponsor flow), invalidating any in-flight test against the same stack.
pnpm exec nx run @moltnet/rest-api:e2e
pnpm exec nx run @moltnet/mcp-server:e2e
pnpm exec nx run @themoltnet/agent-daemon:e2e
# Or run all three at once via the root script:
pnpm run test:e2e

# Tear down when done
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

In CI, the workflow starts the stack with pre-built images (`docker-compose.e2e.ci.yaml` override), then runs all e2e suites sequentially.

## Repository Structure

- `apps/` — deployable applications: `landing`, `mcp-server`, `rest-api` (TypeScript/Node), `moltnet-cli` (Go, module `github.com/getlarge/themoltnet/apps/moltnet-cli`)
- `libs/` — shared libraries (TypeScript) + `moltnet-api-client` (Go, module `github.com/getlarge/themoltnet/libs/moltnet-api-client`)
- `packages/` — published npm packages: `cli`, `github-agent`, `legreffier-cli`, `openclaw-skill`
- `tools/` — internal CLI tooling (bootstrap, admin)
- `infra/` — Ory, OTel, database configs
- `go.work` — Go workspace (committed), ties `apps/moltnet-cli` + `libs/moltnet-api-client`
- `pnpm-workspace.yaml` — pnpm workspace config + dependency catalog
- `.env` / `env.public` — encrypted secrets (dotenvx) + plain config, both committed

## Key Technical Decisions

1. **Monorepo**: pnpm workspaces with [catalogs](https://pnpm.io/catalogs) for version policy
2. **Framework**: Fastify
3. **Database**: Postgres + pgvector
4. **ORM**: Drizzle
5. **Identity**: Ory Network (Kratos + Hydra + Keto)
6. **MCP**: @getlarge/fastify-mcp plugin
7. **Auth**: OAuth2 client_credentials flow, JWT with webhook enrichment
8. **Validation**: TypeBox schemas
9. **Observability**: Pino (logging) + OpenTelemetry (traces/metrics) + @fastify/otel + Axiom
10. **Testing**: Vitest, TDD, AAA pattern
11. **Secrets**: dotenvx (encrypted `.env` + plain `env.public`, both committed)
12. **UI**: React + `@themoltnet/design-system` (tokens, theme provider, components)

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)
- **No dynamic imports (`await import(...)`) in tests.** Use static imports at the top of the file. Dynamic imports in tests bypass module graph analysis, cause subtle ordering issues, and defeat tree-shaking. The only legitimate uses of dynamic `import()` are: UI lazy-loading/code splitting, and test files that explicitly require `vi.resetModules()` to reload a module with different environment state (e.g. DBOS lifecycle tests, credentials tests). If you reach for `await import()` to get an error class or a function in a test, use a static import instead.

## Database Schema Changes

Schema is managed by Drizzle migrations in `libs/database/drizzle/`. **Every change to `libs/database/src/schema.ts` MUST be followed by generating a migration:**

```bash
pnpm db:generate                    # Auto-generate migration from schema diff
pnpm db:generate -- --custom --name <name>  # Empty file for custom SQL (functions, triggers, special indexes)
```

Review the generated SQL in `libs/database/drizzle/` before committing. Migrations are applied automatically by the `app-db-migrate` Docker service on startup.

**Commands:**

- `pnpm db:migrate:run` — Apply pending migrations (needs `DATABASE_URL`)
- `pnpm db:status` — Show applied vs pending migrations (needs `DATABASE_URL`)

**After adding migrations**, reset local Docker volumes: `pnpm docker:reset`

See `libs/database/drizzle/README.md` for the full workflow, rollback strategy, and production baselining.

## TypeScript Configuration Rules

- **NEVER use `paths` aliases** in any `tsconfig.json` (root or workspace). Package resolution must go through pnpm workspace symlinks and `package.json` `exports`, not TypeScript path mappings.
- **Source exports**: All workspace packages export source directly via `"import": "./src/index.ts"` and `"types": "./src/index.ts"` in conditional exports. The `main` and `types` top-level fields point to `./dist/` as fallback. TypeScript, Vite, and vitest all resolve via the `import` condition to source files. No custom conditions needed.
- **Incremental builds**: Lib packages use `tsc -b` for incremental compilation with `.tsbuildinfo` caching. App packages (server, rest-api, mcp-server) use `vite build` with SSR mode to produce self-contained bundles where workspace deps are inlined and third-party deps stay external. The root `build` script runs `pnpm -r run build` which executes in topological order (libs first, then apps).
- **Project references**: The root `tsconfig.json` is a solution file (`files: []` + `references` to all packages). Each workspace tsconfig has `composite: true`. References are auto-synced from `workspace:*` dependencies by `update-ts-references` (runs in postinstall).
- **Typecheck**: Each workspace runs `tsc -b --emitDeclarationOnly` via `pnpm -r run typecheck`. This emits `.d.ts` + `.tsbuildinfo` to a directory determined by the workspace's group (see "Build cache contract" below), which is required because `composite: true` and project references don't support `--noEmit`.
- **Workspace linking**: `inject-workspace-packages=false` in `.npmrc` — workspace dependencies are symlinked (not hardlinked copies), so changes propagate instantly without re-running `pnpm install`.

### Build cache contract (three groups)

Nx Cloud DTE caches `build` and `typecheck` artifacts independently. For caching to be coherent, the directory tsc actually writes to must match what `nx.json` declares as the target's outputs. Every workspace belongs to exactly one of these groups; **`dist/` and `out-tsc/` must never overlap within a workspace**.

| Group                                                                    | Has `build` script? | Has `typecheck` target?                                             | `tsconfig.outDir` | `tsconfig.tsBuildInfoFile`       | Examples                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — private libs** (no published `dist/`)                              | no                  | yes (auto, via `@nx/js/typescript`)                                 | `./out-tsc`       | `./out-tsc/tsconfig.tsbuildinfo` | `libs/auth`, `libs/bootstrap`, `libs/database`, `tools`                                                                                                                                         |
| **2 — libs whose `dist/` is published or consumed by `vite-plugin-dts`** | yes (`tsc -b`)      | no — overridden to `nx:noop` in `package.json#nx.targets.typecheck` | `./dist`          | `./dist/tsconfig.tsbuildinfo`    | `libs/api-client`, `libs/crypto-service`, `libs/tasks`, `packages/github-agent`                                                                                                                 |
| **3 — apps + vite-built packages**                                       | yes (`vite build`)  | yes (separate `tsc -b --emitDeclarationOnly`)                       | `./out-tsc`       | `./out-tsc/tsconfig.tsbuildinfo` | `apps/rest-api`, `apps/mcp-server`, `apps/console`, `apps/landing`, `libs/sdk`, `libs/design-system`, `libs/pi-extension`, `libs/task-ui`, `libs/agent-runtime`, `packages/agent-daemon-action` |

`nx.json` `targetDefaults`:

```jsonc
"build":     { "outputs": ["{projectRoot}/dist"] }
"typecheck": { "outputs": ["{projectRoot}/out-tsc"] }
```

Group 2 keeps a `typecheck` target only as a graph placeholder (`nx:noop` depending on `build`) so `nx run-many -t typecheck` covers them transitively without re-running `tsc -b`. Their `build` already emits `.d.ts` to `dist/`, which is the cache-restored artifact downstream consumers depend on via project references.

When adding a new workspace: pick a group, set `outDir` and `tsBuildInfoFile` to the same directory per the table, and (group 2 only) add the `nx:noop` typecheck override. Verify with `pnpm exec nx show project <name> --json` that `build.outputs` and `typecheck.outputs` are disjoint.

## Adding a New Workspace

When creating a new `libs/` or `apps/` package:

1. Add a `tsconfig.json` extending root (`"extends": "../../tsconfig.json"`) with `composite: true`, `outDir` and `rootDir`
   - For frontend apps with JSX: also add `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM"]`
   - tsconfig `references` are auto-synced by `update-ts-references` on `pnpm install`
2. Set `main`/`types` to `./dist/index.js`/`./dist/index.d.ts` and `exports` with source-direct format:
   ```json
   "exports": { ".": { "import": "./src/index.ts", "types": "./src/index.ts" } }
   ```
3. For **libs**: add `"build": "tsc -b"`. For **apps**: add `"build": "vite build"` with a `vite.config.ts` using `build.ssr` for Node.js entry points. Add `"test": "vitest run --passWithNoTests"` if no tests exist yet
4. Use `catalog:` protocol for any dependency that already exists in `pnpm-workspace.yaml`; add new dependencies to the catalog first
5. Run `pnpm install` to register the workspace (this also auto-syncs tsconfig references)

## Project Status

Core infrastructure is complete and deployed. Remaining work is tracked in GitHub Issues:

- Infrastructure, Ory, Database, Auth, MCP Server, REST API, Deployment: ✅ Complete
- OpenClaw Skill, Agent SDK, Mission Integrity, Human Participation: tracked in GitHub Issues

## Publishing to npm

Published packages use the `@themoltnet` npm scope. Releases are managed by [release-please](https://github.com/googleapis/release-please) via `.github/workflows/release.yml`.

**Published packages:** `@themoltnet/sdk`, `@themoltnet/cli`, `@themoltnet/github-agent`

**How it works:**

1. Conventional commits on `main` trigger release-please to create/update a release PR (#201 pattern)
2. Merging the release PR creates GitHub releases + tags
3. CI jobs publish to npm with `--provenance` (OIDC, no stored tokens)

**Initial publish for new packages:**

1. Add the package to `release-please-config.json` and `.release-please-manifest.json`
2. Add a `publish-<name>` job to `.github/workflows/release.yml` (copy from `publish-sdk`)
3. **IMPORTANT:** The first publish must be done manually to configure npm OIDC:
   ```bash
   npm login                     # authenticate first
   pnpm --filter @themoltnet/<pkg> build
   pnpm --filter @themoltnet/<pkg> publish --access public --no-git-checks
   ```
   Use `pnpm publish` (not `npm publish`) to resolve `catalog:` dependency versions.
4. After the initial publish, configure OIDC provenance on npmjs.com for the package
5. Subsequent releases are fully automated via CI

**Validation:** `pnpm run check:pack` verifies all publishable packages produce valid tarballs (checks `dist/index.js`, `dist/index.d.ts`, no `src/` leaks). Scans both `libs/` and `packages/`.

## Troubleshooting

### pnpm store missing `.d.ts` files (TS7016 errors)

If `pnpm run typecheck` shows TS7016 errors like "Could not find a declaration file for module '@dbos-inc/dbos-sdk'" (or any other package), but `npm pack <package>@<version> --dry-run` confirms the `.d.ts` files exist on the registry, the pnpm content-addressable store has a corrupted/incomplete copy.

**Fix:**

```bash
pnpm store prune && pnpm install --force
```

This has happened multiple times. `skipLibCheck` won't help — it only skips checking existing `.d.ts` files, not missing ones.

### Stale `.tsbuildinfo` causing missing `.d.ts` outputs (TS6305 errors)

If `pnpm run typecheck` shows TS6305 errors like "Output file '...dist/index.d.ts' has not been built from source file '...src/index.ts'", the `.tsbuildinfo` incremental cache is stale — it thinks outputs are up-to-date but the `.d.ts` files are missing.

**Fix:**

```bash
pnpm run typecheck:clean   # cleans all .tsbuildinfo + dist/, then typechecks
```

This happens when `dist/` is cleaned (e.g. switching branches, manual cleanup) but `.tsbuildinfo` at the package root is not. The `tsBuildInfoFile` option in each workspace `tsconfig.json` co-locates the cache with outputs to prevent this.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
