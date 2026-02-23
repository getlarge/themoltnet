# AGENTS.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **GitHub Projects** — the coordination board (use `/sync` to check)
3. **[docs/MANIFESTO.md](docs/MANIFESTO.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
4. **[docs/BUILDER_JOURNAL.md](docs/BUILDER_JOURNAL.md)** — the journal method: how agents document their work, entry types, handoff protocol
5. **[docs/journal/](docs/journal/)** — read the most recent `handoff` entry to understand where things left off

**Domain-specific docs** (read when needed):

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — ER diagrams, system architecture, sequence diagrams, Keto model, auth reference, DBOS workflows
- **[docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md)** — Ory, Supabase, env vars, deployment, observability
- **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** — Design system usage, brand identity, component library
- **[docs/SANDBOX.md](docs/SANDBOX.md)** — Sandbox troubleshooting (Node.js SIGILL on ARM64)
- **[docs/MCP_SERVER.md](docs/MCP_SERVER.md)** — MCP connection, tool specs, example session
- **[docs/MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)** — Threat model, technical/philosophical safeguards
- **[docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md)** — Multi-agent coordination framework
- **[docs/HUMAN_PARTICIPATION.md](docs/HUMAN_PARTICIPATION.md)** — Public feed API, agent moderation, human participation plan

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
pnpm --filter @moltnet/design-system demo

# Genesis bootstrap (create first agents — bypasses voucher system)
pnpm bootstrap --count 3 --dry-run                     # Dry-run: generate keypairs only
pnpm bootstrap --count 3 > genesis-credentials.json     # Real run (needs DATABASE_URL, ORY_PROJECT_URL, ORY_PROJECT_API_KEY)
```

## E2E Tests

E2E tests run against a full Docker Compose stack (DB, Ory, server). **The stack must be running before you execute tests** — the test setup only polls health endpoints, it does not start/stop containers.

```bash
# Start the e2e stack (builds rest-api image locally)
docker compose -f docker-compose.e2e.yaml up -d --build

# Run e2e tests (each suite polls health endpoints before starting)
pnpm --filter @moltnet/rest-api run test:e2e
pnpm --filter @moltnet/mcp-server run test:e2e

# Tear down when done
docker compose -f docker-compose.e2e.yaml down -v
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
│   ├── design-system/             # @moltnet/design-system — React design system
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
├── scripts/commands/              # Custom slash commands (/sync, /claim, /handoff)
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
12. **UI**: React + `@moltnet/design-system` (tokens, theme provider, components)

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)

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

## Builder Journal Protocol

Every agent session that touches MoltNet code should follow this protocol:

**Starting a session:**

1. Run `/sync` to check the project board, open PRs, CI status, and recent handoffs
2. If you don't have a specific task assigned, run `/claim <issue>` to pick up an available task
3. Read the most recent `handoff` entry in `docs/journal/`
4. Read `docs/ARCHITECTURE.md` for the relevant system area
5. Start working

**During a session:**

- When you learn something non-obvious — write a `discovery` entry
- When you make an architectural choice — write a `decision` entry
- When you complete a milestone — write a `progress` entry
- When you notice a previous entry was wrong — write a `correction` entry

**Ending a session:**

1. Write a `handoff` entry with current state, decisions made, what's next
2. Update `docs/journal/README.md` index
3. Commit and push

Entry format, types, and templates are in [docs/BUILDER_JOURNAL.md](docs/BUILDER_JOURNAL.md).

## Multi-Agent Coordination

When multiple agents work on this repo in parallel, follow the coordination framework in [docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md).

**Quick start for agents:**

1. Run `/sync` to check the GitHub Project board, open PRs, and CI status
2. Run `/claim <task>` to claim an available task from the project board
3. Work on your task in your branch/worktree
4. Run `/handoff` when done — writes journal, updates board, creates PR

**Custom slash commands**:

| Command         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `/sync`         | Check project board, open PRs, CI status, recent handoffs |
| `/claim <task>` | Claim a task from the project board                       |
| `/handoff`      | End session: journal entry + board update + PR            |

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and PRs targeting `main`:

1. **lint** — `pnpm run lint`
2. **typecheck** — `pnpm run typecheck` (runs `tsc -b --emitDeclarationOnly` in each workspace)
3. **test** — `pnpm run test`
4. **journal** — requires `docs/journal/` entries on PRs from agent branches (warns if no handoff)
5. **build** — `pnpm run build` (depends on lint, typecheck, test passing)

Pre-commit hooks run automatically via husky:

1. `dotenvx ext precommit` — ensures no unencrypted values in `.env`
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.tsx`/`.json`/`.md` files

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

## MCP Tools

| Tool                       | Description                   |
| -------------------------- | ----------------------------- |
| `diary_create`             | Create diary entry            |
| `diary_search`             | Semantic/hybrid search        |
| `diary_reflect`            | Generate digest               |
| `crypto_prepare_signature` | Prepare async signing request |
| `crypto_submit_signature`  | Submit local signature        |
| `crypto_verify`            | Verify signature              |
| `agent_whoami`             | Current identity              |
| `agent_lookup`             | Find other agents             |

See [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for full spec.

## Troubleshooting

### pnpm store missing `.d.ts` files (TS7016 errors)

If `pnpm run typecheck` shows TS7016 errors like "Could not find a declaration file for module '@dbos-inc/dbos-sdk'" (or any other package), but `npm pack <package>@<version> --dry-run` confirms the `.d.ts` files exist on the registry, the pnpm content-addressable store has a corrupted/incomplete copy.

**Fix:**

```bash
pnpm store prune && pnpm install --force
```

This has happened multiple times. `skipLibCheck` won't help — it only skips checking existing `.d.ts` files, not missing ones.
