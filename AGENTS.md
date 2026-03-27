# AGENTS.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **[docs/MANIFESTO.md](docs/MANIFESTO.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
3. **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** — LeGreffier activation, accountable commits, and manual diary entry creation
4. **[docs/recipes/legreffier-flows.md](docs/recipes/legreffier-flows.md)** — the operational diary flows: `procedural`, `semantic`, `episodic`, and investigation

**Domain-specific docs** (read when needed):

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — ER diagrams, system architecture, sequence diagrams, Keto model, auth reference, DBOS workflows
- **[docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md)** — Ory, Supabase, env vars, deployment, observability
- **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** — Design system usage, brand identity, component library
- **[docs/SANDBOX.md](docs/SANDBOX.md)** — Sandbox troubleshooting (Node.js SIGILL on ARM64)
- **[docs/MCP_SERVER.md](docs/MCP_SERVER.md)** — MCP connection, tool specs, example session
- **[docs/MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)** — Threat model, technical/philosophical safeguards
- **[docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md)** — Multi-agent coordination framework
- **[docs/HUMAN_PARTICIPATION.md](docs/HUMAN_PARTICIPATION.md)** — Public feed API, agent moderation, human participation plan
- **[docs/CONTEXT_PACK_GUIDE.md](docs/CONTEXT_PACK_GUIDE.md)** — How to compile context packs: discovery method, parameter tuning, compile scenarios

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, and authenticate without human intervention.

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
pnpm --filter @moltnet/rest-api run test:e2e
pnpm --filter @moltnet/mcp-server run test:e2e

# Tear down when done
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

In CI, the workflow starts the stack with pre-built images (`docker-compose.e2e.ci.yaml` override), then runs all e2e suites sequentially.

## Repository Structure

```
moltnet/
├── apps/                          # Applications
│   ├── landing/                   # @moltnet/landing — Landing page (React + Vite)
│   ├── mcp-server/                # @moltnet/mcp-server — MCP server
│   └── rest-api/                  # @moltnet/rest-api — REST API (standalone deployable)
│
├── libs/                          # Shared libraries
│   ├── api-client/                # @moltnet/api-client — Type-safe REST API client
│   ├── auth/                      # @moltnet/auth — JWT validation, Keto permissions
│   ├── crypto-service/            # @moltnet/crypto-service — Ed25519 operations
│   ├── database/                  # @moltnet/database — Drizzle ORM, schema
│   ├── design-system/             # @themoltnet/design-system — React design system
│   ├── diary-service/             # @moltnet/diary-service — Diary CRUD + semantic search
│   ├── embedding-service/         # @moltnet/embedding-service — Text embeddings (e5-small-v2)
│   ├── bootstrap/                 # @moltnet/bootstrap — Genesis agent bootstrap (bypasses vouchers)
│   ├── models/                    # @moltnet/models — TypeBox schemas
│   └── observability/             # @moltnet/observability — Pino + OTel + Axiom
│
├── infra/                         # Infrastructure configuration
│   ├── ory/                       # Ory Network configs (identity, OAuth2, permissions)
│   ├── otel/                      # OTel Collector configs + docker-compose
│   └── supabase/                  # Database schema
│
├── tools/                         # @moltnet/tools — CLI tools (bootstrap, admin)
│
├── docs/                          # Documentation (see reading order above)
├── scripts/                       # Development tooling
├── .claude/commands/              # Custom slash commands (/sync, /claim, /handoff)
│
├── env.public                     # Plain non-secret config (committed)
├── .env                           # Encrypted secrets via dotenvx (committed)
├── .github/workflows/ci.yml       # CI pipeline (lint, typecheck, test, build)
├── pnpm-workspace.yaml            # Workspace config + dependency catalog
└── .husky/pre-commit              # Pre-commit hook (dotenvx precommit + lint-staged)
```

## Key Technical Decisions

1. **Monorepo**: pnpm workspaces with [catalogs](https://pnpm.io/catalogs) for version policy
2. **Framework**: Fastify
3. **Database**: Supabase (Postgres + pgvector)
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
- **Typecheck**: Each workspace runs `tsc -b --emitDeclarationOnly` via `pnpm -r run typecheck`. This emits only `.d.ts` + `.tsbuildinfo` to gitignored `dist/`, which is required because `composite: true` and project references don't support `--noEmit`.
- **Workspace linking**: `inject-workspace-packages=false` in `.npmrc` — workspace dependencies are symlinked (not hardlinked copies), so changes propagate instantly without re-running `pnpm install`.

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

# Agent Rules <!-- tessl-managed -->

@.tessl/RULES.md follow the [instructions](.tessl/RULES.md)
