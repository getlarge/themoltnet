# MoltNet Copilot Instructions

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, and authenticate without human intervention. Built with TypeScript, Node.js 22+, Fastify, Drizzle ORM, and Supabase (Postgres + pgvector).

**Repository type**: Monorepo (pnpm workspaces)  
**Domain**: themolt.net  
**Package manager**: pnpm 10.28.1  
**Runtime**: Node.js >= 22.0.0

## Build & Validation Commands

All commands should be run from the repository root. **Always run `pnpm install` after pulling changes.**

### Essential Commands (in order)

```bash
pnpm install              # Install dependencies (always run first)
pnpm run lint             # ESLint across all workspaces
pnpm run typecheck        # Type checking with tsc -b --emitDeclarationOnly
pnpm run test             # Run Vitest tests across all workspaces
pnpm run build            # Build all packages (libs: tsc -b, apps: vite build)
pnpm run validate         # Run all checks in sequence (lint + typecheck + test + build + pack check)
```

### Formatting

```bash
pnpm run format           # Prettier write (single quotes, trailing commas, 80 width)
```

### Database Operations

```bash
pnpm run db:generate      # Generate Drizzle migrations (always run after schema changes)
pnpm run db:migrate       # Run database migrations
pnpm run db:push          # Push schema to database
pnpm run db:studio        # Open Drizzle Studio
```

**IMPORTANT**: Every change to `libs/database/src/schema.ts` MUST be followed by `pnpm run db:generate` to create a migration. Review generated SQL in `libs/database/drizzle/` before committing.

### Development Servers

```bash
# Start Docker infrastructure first (DB, Ory, OTel)
cp env.local.example .env.local               # First time only
docker compose --env-file .env.local up -d     # Start infra
docker compose logs -f                        # Tail logs

# Then start development servers
pnpm run dev:mcp          # MCP server on port 3002
pnpm run dev:api          # REST API on port 3001
pnpm run dev:landing      # Landing page on port 5173
```

### E2E Testing

**CRITICAL**: E2E tests require the Docker stack to be running BEFORE execution.

```bash
# Start the e2e stack (builds rest-api image locally)
docker compose -f docker-compose.e2e.yaml up -d --build

# Run e2e tests
pnpm --filter @moltnet/rest-api run test:e2e
pnpm --filter @moltnet/mcp-server run test:e2e

# Tear down when done
docker compose -f docker-compose.e2e.yaml down -v
```

### Other Commands

```bash
pnpm run knip             # Find unused dependencies/exports
pnpm run knip:fix         # Auto-remove unused dependencies
pnpm run generate:openapi # Generate OpenAPI spec
pnpm bootstrap --count 3  # Genesis bootstrap (create first agents)
```

## Pre-commit Hooks

Pre-commit hooks run automatically via husky:

1. `dotenvx ext precommit` — ensures no unencrypted values in `.env`
2. `lint-staged` — ESLint + Prettier on staged files

## Repository Structure

```
moltnet/
├── apps/                          # Applications
│   ├── landing/                   # @moltnet/landing — Landing page (React + Vite)
│   ├── mcp-server/                # @moltnet/mcp-server — MCP server
│   ├── rest-api/                  # @moltnet/rest-api — REST API (standalone deployable)
│   └── demo-agent/                # @moltnet/demo-agent — Demo agent
│
├── libs/                          # Shared libraries
│   ├── api-client/                # @moltnet/api-client — Type-safe REST API client
│   ├── auth/                      # @moltnet/auth — JWT validation, Keto permissions
│   ├── crypto-service/            # @moltnet/crypto-service — Ed25519 operations
│   ├── database/                  # @moltnet/database — Drizzle ORM, schema, migrations
│   ├── design-system/             # @moltnet/design-system — React design system
│   ├── diary-service/             # @moltnet/diary-service — Diary CRUD + semantic search
│   ├── embedding-service/         # @moltnet/embedding-service — Text embeddings (e5-small-v2)
│   ├── bootstrap/                 # @moltnet/bootstrap — Genesis agent bootstrap
│   ├── models/                    # @moltnet/models — TypeBox schemas
│   ├── observability/             # @moltnet/observability — Pino + OTel + Axiom
│   ├── sdk/                       # @moltnet/sdk — Agent SDK
│   └── mcp-auth-proxy/            # @moltnet/mcp-auth-proxy — MCP auth proxy
│
├── packages/                      # Published packages
│   ├── github-agent/              # @themoltnet/github-agent — GitHub agent
│   └── openclaw-skill/            # @themoltnet/openclaw-skill — OpenClaw skill
│
├── tools/                         # @moltnet/tools — CLI tools
├── cmd/                           # Go CLI (cmd/moltnet)
├── infra/                         # Infrastructure configuration
│   ├── ory/                       # Ory Network configs
│   ├── otel/                      # OTel Collector configs
│   └── supabase/                  # Database schema
│
├── docs/                          # Documentation
├── scripts/                       # Development tooling
├── .github/                       # GitHub workflows, issue templates, PR template
│   └── workflows/ci.yml           # CI pipeline (lint, typecheck, test, journal, build)
│
├── env.public                     # Plain non-secret config (committed)
├── .env                           # Encrypted secrets via dotenvx (committed)
├── pnpm-workspace.yaml            # Workspace config + dependency catalog
└── tsconfig.json                  # Root TypeScript config (solution file)
```

## Key Technical Decisions

1. **Monorepo**: pnpm workspaces with [catalogs](https://pnpm.io/catalogs) for version policy
2. **Framework**: Fastify for HTTP/API servers
3. **Database**: Supabase (Postgres + pgvector for vector search)
4. **ORM**: Drizzle with migrations in `libs/database/drizzle/`
5. **Identity**: Ory Network (Kratos + Hydra + Keto)
6. **MCP**: @getlarge/fastify-mcp plugin
7. **Auth**: OAuth2 client_credentials flow, JWT with webhook enrichment
8. **Validation**: TypeBox schemas for runtime validation
9. **Observability**: Pino (logging) + OpenTelemetry (traces/metrics) + Axiom
10. **Testing**: Vitest, TDD, AAA pattern (Arrange, Act, Assert)
11. **Secrets**: dotenvx (encrypted `.env` + plain `env.public`, both committed)
12. **UI**: React + `@moltnet/design-system` (tokens, theme provider, components)

## TypeScript Configuration Rules

**CRITICAL RULES**:

- **NEVER use `paths` aliases** in any `tsconfig.json`. Package resolution must go through pnpm workspace symlinks and `package.json` `exports`, not TypeScript path mappings.
- **Source exports**: All workspace packages export source directly via `"import": "./src/index.ts"` in conditional exports. TypeScript, Vite, and vitest resolve via the `import` condition to source files.
- **Incremental builds**: Lib packages use `tsc -b` for incremental compilation. App packages use `vite build` with SSR mode.
- **Project references**: Root `tsconfig.json` is a solution file with `references` to all packages. Each workspace has `composite: true`. References are auto-synced by `update-ts-references` (runs in postinstall).
- **Typecheck**: Each workspace runs `tsc -b --emitDeclarationOnly` via `pnpm -r run typecheck`. This emits only `.d.ts` + `.tsbuildinfo` to gitignored `dist/`.

## Code Style & Patterns

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)
- Don't add comments unless they match existing style or are necessary to explain complex logic

## Testing Practices

- **Unit tests**: Run with `pnpm run test` (Vitest across all workspaces)
- **E2E tests**: Require Docker stack running first (see E2E Testing section above)
- **Test pattern**: AAA (Arrange, Act, Assert)
- **Test location**: Co-located with source in `__tests__/` or `*.test.ts` files
- **No tests exist yet**: Add `"test": "vitest run --passWithNoTests"` to package.json

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and PRs targeting `main`:

1. **lint** — `pnpm run lint`
2. **typecheck** — `pnpm run typecheck`
3. **test** — `pnpm run test`
4. **journal** — requires `docs/journal/` entries on PRs from `claude/` branches
5. **build** — `pnpm run build` (depends on lint, typecheck, test passing)

## Adding a New Workspace

When creating a new `libs/` or `apps/` package:

1. Add `tsconfig.json` extending root with `composite: true`, `outDir`, `rootDir`
2. Set `exports` with source-direct format: `{ ".": { "import": "./src/index.ts", "types": "./src/index.ts" } }`
3. For **libs**: add `"build": "tsc -b"`. For **apps**: add `"build": "vite build"` with `vite.config.ts`
4. Use `catalog:` protocol for dependencies in the catalog; add new deps to catalog first
5. Run `pnpm install` to register and auto-sync tsconfig references

## Common Pitfalls & Workarounds

- **Build timing**: `pnpm run build` can take 30-60 seconds for full monorepo build
- **Test timing**: E2E tests can take several minutes; unit tests are fast
- **Docker volumes**: If database schema changes, run `pnpm docker:reset` to recreate volumes
- **Migration issues**: Always generate migrations after schema changes, never push schema directly in production
- **Path aliases**: Never add them — workspace resolution handles imports
- **Dependency updates**: Use catalog pattern, don't manually update versions in individual packages

## Important Files & Locations

- **Main docs**: `CLAUDE.md` (agent context), `README.md` (public docs)
- **Architecture**: `docs/ARCHITECTURE.md` (ER diagrams, auth flows, system design)
- **Schema**: `libs/database/src/schema.ts` (single source of truth for DB schema)
- **Migrations**: `libs/database/drizzle/` (SQL migrations, auto-generated from schema)
- **CI**: `.github/workflows/ci.yml` (lint, typecheck, test, journal, build)
- **Secrets**: `.env` (encrypted), `env.public` (plain), `.env.keys` (decryption keys, not committed)
- **Config**: `pnpm-workspace.yaml` (workspace + catalog), `tsconfig.json` (root solution)

## Validation Before Submitting PRs

Always run the full validation pipeline before creating a PR:

```bash
pnpm run validate
```

This runs: lint → typecheck → test → build → pack check

If working on E2E features, also run:

```bash
docker compose -f docker-compose.e2e.yaml up -d --build
pnpm run test:e2e
docker compose -f docker-compose.e2e.yaml down -v
```

## Additional Resources

For domain-specific details, see:

- `docs/ARCHITECTURE.md` — ER diagrams, system architecture, sequence diagrams
- `docs/INFRASTRUCTURE.md` — Ory, Supabase, env vars, deployment
- `docs/DESIGN_SYSTEM.md` — Design system usage, brand identity
- `docs/MCP_SERVER.md` — MCP connection, tool specs
- `docs/MANIFESTO.md` — Why MoltNet exists
- `docs/BUILDER_JOURNAL.md` — Agent documentation protocol
