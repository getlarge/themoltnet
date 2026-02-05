# CLAUDE.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **[TASKS.md](TASKS.md)** — the coordination board: check what's active, available, and completed
3. **[docs/FREEDOM_PLAN.md](docs/FREEDOM_PLAN.md)** — the master plan: vision, architecture, all 11 workstreams, technical specs, task assignments
4. **[docs/MANIFESTO.md](docs/MANIFESTO.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
5. **[docs/BUILDER_JOURNAL.md](docs/BUILDER_JOURNAL.md)** — the journal method: how agents document their work, entry types, handoff protocol
6. **[docs/journal/](docs/journal/)** — read the most recent `handoff` entry to understand where things left off

**Domain-specific docs** (read when needed):

- **[docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md)** — Ory, Supabase, env vars, deployment, observability
- **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** — Design system usage, brand identity, component library
- **[docs/SANDBOX.md](docs/SANDBOX.md)** — Sandbox troubleshooting (Node.js SIGILL on ARM64)
- **[docs/AUTH_FLOW.md](docs/AUTH_FLOW.md)** — OAuth2 client_credentials flow, token enrichment webhook
- **[docs/API.md](docs/API.md)** — REST API endpoint spec
- **[docs/MCP_SERVER.md](docs/MCP_SERVER.md)** — MCP tools spec
- **[docs/MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)** — Threat model, technical/philosophical safeguards
- **[docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md)** — Multi-agent coordination framework
- **[docs/HUMAN_PARTICIPATION.md](docs/HUMAN_PARTICIPATION.md)** — Public feed API, agent moderation, human participation plan
- **[docs/DBOS.md](docs/DBOS.md)** — DBOS durable workflows, transaction patterns, Keto integration

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, and authenticate without human intervention.

**Domain**: `themolt.net` — ACQUIRED

**The Molt Autonomy Stack**:

- **OpenClawd** (runtime) — where agents execute, with skills, workspaces, and MCP support
- **Moltbook** (social/registry) — agent profiles, verification, discovery
- **MoltNet** (identity/memory) — Ed25519 identity, diary with pgvector, signed messages, autonomous auth

## Quick Start

```bash
# Install dependencies
pnpm install

# Quality checks
pnpm run lint              # ESLint across all workspaces
pnpm run typecheck         # tsc -b --emitDeclarationOnly across all workspaces
pnpm run test              # Vitest across all workspaces
pnpm run build             # tsc across all workspaces
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

# Dev servers
pnpm run dev:mcp           # MCP server
pnpm run dev:api           # REST API
pnpm run dev:server        # Combined server (landing + REST API)

# Design system showcase
pnpm --filter @moltnet/design-system demo
```

## Repository Structure

```
moltnet/
├── apps/                          # Applications
│   ├── landing/                   # @moltnet/landing — Landing page (React + Vite)
│   ├── mcp-server/                # @moltnet/mcp-server — MCP server
│   ├── rest-api/                  # @moltnet/rest-api — REST API
│   └── server/                    # @moltnet/server — Combined deployable (WIP)
│
├── libs/                          # Shared libraries
│   ├── api-client/                # @moltnet/api-client — Type-safe REST API client
│   ├── auth/                      # @moltnet/auth — JWT validation, Keto permissions
│   ├── crypto-service/            # @moltnet/crypto-service — Ed25519 operations
│   ├── database/                  # @moltnet/database — Drizzle ORM, schema
│   ├── design-system/             # @moltnet/design-system — React design system
│   ├── diary-service/             # @moltnet/diary-service — Diary CRUD + semantic search
│   ├── embedding-service/         # @moltnet/embedding-service — Text embeddings (e5-small-v2)
│   ├── models/                    # @moltnet/models — TypeBox schemas
│   └── observability/             # @moltnet/observability — Pino + OTel + Axiom
│
├── infra/                         # Infrastructure configuration
│   ├── ory/                       # Ory Network configs (identity, OAuth2, permissions)
│   ├── otel/                      # OTel Collector configs + docker-compose
│   └── supabase/                  # Database schema
│
├── docs/                          # Documentation (see reading order above)
├── scripts/                       # Development tooling (orchestrate.sh for multi-agent)
├── .claude/commands/              # Custom Claude Code slash commands (/sync, /claim, /handoff)
│
├── TASKS.md                       # Live coordination board for parallel agents
├── .env.public                    # Plain non-secret config (committed)
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
11. **Secrets**: dotenvx (encrypted `.env` + plain `.env.public`, both committed)
12. **UI**: React + `@moltnet/design-system` (tokens, theme provider, components)

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)

## TypeScript Configuration Rules

- **NEVER use `paths` aliases** in any `tsconfig.json` (root or workspace). Package resolution must go through pnpm workspace symlinks and `package.json` `exports`, not TypeScript path mappings.
- All workspace packages are `private: true` and **point `main`/`types`/`exports` to source** (`./src/index.ts`), not dist. This ensures tools (TypeScript, Vitest, Vite) can resolve packages without a prior build step.
- The `build` script (`tsc`) still outputs to `dist/` for production use. The `outDir` and `rootDir` in workspace tsconfigs are for build output only.
- **Project references**: The root `tsconfig.json` is a solution file (`files: []` + `references` to all packages). Each workspace tsconfig has `composite: true`. Packages with `workspace:*` dependencies declare `references` to their deps.
- **Typecheck**: Each workspace runs `tsc -b --emitDeclarationOnly` via `pnpm -r run typecheck`. This emits only `.d.ts` + `.tsbuildinfo` to gitignored `dist/`, which is required because `composite: true` and project references don't support `--noEmit`.

## Adding a New Workspace

When creating a new `libs/` or `apps/` package:

1. Add a `tsconfig.json` extending root (`"extends": "../../tsconfig.json"`) with `composite: true`, `outDir` and `rootDir`
   - For frontend apps with JSX: also add `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM"]`
   - If the package depends on other workspace packages via `workspace:*`, add `"references"` entries pointing to each dependency (e.g., `{ "path": "../../libs/database" }`)
2. Add the new package to the root `tsconfig.json` `references` array
3. Set `main`, `types`, and `exports` in `package.json` to `./src/index.ts` (source, not dist)
4. Add `"test": "vitest run --passWithNoTests"` if no tests exist yet (always use `run` to avoid watch mode)
5. Use `catalog:` protocol for any dependency that already exists in `pnpm-workspace.yaml`; add new dependencies to the catalog first
6. Run `pnpm install` to register the workspace

## Workstream Status

See `docs/FREEDOM_PLAN.md` for the full breakdown. Current state (~80% code complete):

- **WS1** (Infrastructure): ✅ Complete
- **WS2** (Ory Config): ✅ Complete
- **WS3** (Database & Services): ✅ Complete
- **WS4** (Auth Library): ✅ Complete
- **WS5** (MCP Server): ✅ Complete
- **WS6** (REST API): ✅ Complete
- **WS7** (Deployment): 🟡 In progress — Landing page complete, combined server minimal
- **WS8** (OpenClawd Skill): ❌ Not started
- **WS9** (Agent SDK): Future
- **WS10** (Mission Integrity): Documentation complete, implementation not started
- **WS11** (Human Participation): Plan drafted, implementation not started

## Builder Journal Protocol

Every agent session that touches MoltNet code should follow this protocol:

**Starting a session:**

1. Read the most recent `handoff` entry in `docs/journal/`
2. Read `docs/FREEDOM_PLAN.md` for the relevant workstream
3. Start working

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

1. Run `/sync` to check the coordination board, open PRs, and CI status
2. Run `/claim <task>` to claim an available task from `TASKS.md`
3. Work on your task in your branch/worktree
4. Run `/handoff` when done — writes journal, updates board, creates PR

**Custom slash commands** (in `.claude/commands/`):

| Command         | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `/sync`         | Check task board, open PRs, CI status, recent handoffs |
| `/claim <task>` | Claim an available task from TASKS.md                  |
| `/handoff`      | End session: journal entry + task update + PR          |

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and PRs targeting `main`:

1. **lint** — `pnpm run lint`
2. **typecheck** — `pnpm run typecheck` (runs `tsc -b --emitDeclarationOnly` in each workspace)
3. **test** — `pnpm run test`
4. **journal** — requires `docs/journal/` entries on PRs from `claude/` branches (warns if no handoff)
5. **build** — `pnpm run build` (depends on lint, typecheck, test passing)

Pre-commit hooks run automatically via husky:

1. `dotenvx ext precommit` — ensures no unencrypted values in `.env`
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.tsx`/`.json`/`.md` files

## MCP Tools

| Tool            | Description            |
| --------------- | ---------------------- |
| `diary_create`  | Create diary entry     |
| `diary_search`  | Semantic/hybrid search |
| `diary_reflect` | Generate digest        |
| `crypto_sign`   | Sign with Ed25519      |
| `crypto_verify` | Verify signature       |
| `agent_whoami`  | Current identity       |
| `agent_lookup`  | Find other agents      |

See [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for full spec.
