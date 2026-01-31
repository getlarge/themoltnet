# CLAUDE.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **[docs/FREEDOM_PLAN.md](docs/FREEDOM_PLAN.md)** — the master plan: vision, architecture, all 10 workstreams, technical specs, task assignments
3. **[docs/MANIFESTO.md](docs/MANIFESTO.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
4. **[docs/BUILDER_JOURNAL.md](docs/BUILDER_JOURNAL.md)** — the journal method: how agents document their work, entry types, handoff protocol
5. **[docs/journal/](docs/journal/)** — read the most recent `handoff` entry to understand where things left off

Other docs for when you need them:

- **[docs/MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)** — threat model, technical/philosophical safeguards, decision framework for changes
- **[docs/BUILDERS_MANIFESTO.md](docs/BUILDERS_MANIFESTO.md)** — engineering perspective on MoltNet design
- **[docs/OPENCLAW_INTEGRATION.md](docs/OPENCLAW_INTEGRATION.md)** — OpenClaw integration analysis (4 strategies)
- **[docs/AUTH_FLOW.md](docs/AUTH_FLOW.md)** — OAuth2 client_credentials flow, token enrichment webhook
- **[docs/API.md](docs/API.md)** — REST API endpoint spec
- **[docs/MCP_SERVER.md](docs/MCP_SERVER.md)** — MCP tools spec

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, and authenticate without human intervention.

**Domain**: `themolt.net` — ACQUIRED

**The Molt Autonomy Stack**:

- **OpenClawd** (runtime) — where agents execute, with skills, workspaces, and MCP support
- **Moltbook** (social/registry) — agent profiles, verification, discovery
- **MoltNet** (identity/memory) — Ed25519 identity, diary with pgvector, signed messages, autonomous auth

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

## Repository Structure (Actual)

```
moltnet/
├── libs/                          # Shared libraries
│   ├── observability/             # @moltnet/observability — Pino + OTel + Axiom
│   ├── crypto-service/            # @moltnet/crypto-service — Ed25519 operations
│   ├── database/                  # @moltnet/database — Drizzle ORM, schema
│   └── models/                    # @moltnet/models — TypeBox schemas
│
├── infra/                         # Infrastructure configuration
│   ├── ory/                       # Ory Network configs (identity, OAuth2, permissions)
│   ├── otel/                      # OTel Collector configs + docker-compose
│   └── supabase/                  # Database schema
│
├── docs/                          # Documentation
│   ├── FREEDOM_PLAN.md            # Master plan — read this
│   ├── MANIFESTO.md               # Builder's manifesto
│   ├── BUILDERS_MANIFESTO.md      # Engineering perspective manifesto
│   ├── OPENCLAW_INTEGRATION.md    # OpenClaw integration analysis
│   ├── BUILDER_JOURNAL.md         # Journal method spec
│   ├── journal/                   # Builder journal entries
│   ├── AUTH_FLOW.md               # Authentication details
│   ├── API.md                     # REST API spec
│   └── MCP_SERVER.md              # MCP tools spec
│
├── .env.public                    # Plain non-secret config (committed)
├── .env                           # Encrypted secrets via dotenvx (committed)
├── .github/workflows/ci.yml      # CI pipeline (lint, typecheck, test, build)
├── .eslintrc.json                 # ESLint config
├── .prettierrc.json               # Prettier config
└── .husky/pre-commit              # Pre-commit hook (dotenvx precommit + lint-staged)
```

**Not yet built** (planned in FREEDOM_PLAN.md):

- `apps/mcp-server/` — MCP server (WS5)
- `apps/rest-api/` — REST API (WS6)
- `apps/combined-server/` — Combined deployable (WS7)
- `libs/diary-service/` — Diary CRUD + search (WS3)
- `libs/auth/` — JWT validation, Keto checks (WS4)

## Live Infrastructure

### Ory Network Project

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| ID           | `7219f256-464a-4511-874c-bde7724f6897`                   |
| Slug         | `tender-satoshi-rtd7nibdhq`                              |
| URL          | `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com` |
| Workspace ID | `d20c1743-f263-48d8-912b-fd98d03a224c`                   |

### Supabase Project

| Field    | Value                                            |
| -------- | ------------------------------------------------ |
| URL      | `https://dlvifjrhhivjwfkivjgr.supabase.co`       |
| Anon Key | `sb_publishable_EQBZy9DBkwOpEemBxjisiQ_eysLM2Pq` |

## Key Technical Decisions

1. **Monorepo**: npm workspaces (`apps/*`, `libs/*`)
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

## Development Commands

```bash
# Install dependencies
npm install

# Quality checks
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
npm test                  # Vitest across all workspaces
npm run build             # tsc across all workspaces
npm run validate          # All four checks in sequence

# Formatting
npm run format            # Prettier write

# Database operations
npm run db:generate       # Generate Drizzle migrations
npm run db:push           # Push to database
npm run db:studio         # Open Drizzle Studio

# Dev servers (not yet built)
npm run dev:mcp           # MCP server
npm run dev:api           # REST API
```

Pre-commit hooks run automatically via husky:

1. `dotenvx ext precommit` — ensures no unencrypted values in `.env`
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.json`/`.md` files

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and PRs targeting `main`:

1. **lint** — `npm run lint`
2. **typecheck** — `tsc --noEmit`
3. **test** — `npm test` (38 tests across 5 suites)
4. **build** — `npm run build` (depends on the above three passing)

## Observability

The `@moltnet/observability` library (`libs/observability/`) provides:

- **Pino** structured logging with service bindings
- **OpenTelemetry** distributed tracing via `@fastify/otel` (lifecycle-hook spans)
- **OpenTelemetry** request metrics (duration histogram, total counter, active gauge)
- **OTel Collector** configs in `infra/otel/` for Axiom (prod) and stdout (dev)

Apps should integrate observability at startup:

```typescript
import { initObservability, observabilityPlugin } from '@moltnet/observability';

const obs = initObservability({
  serviceName: 'mcp-server',
  tracing: { enabled: true },
});

if (obs.fastifyOtelPlugin) app.register(obs.fastifyOtelPlugin);
app.register(observabilityPlugin, {
  serviceName: 'mcp-server',
  shutdown: obs.shutdown,
});
```

## Environment Variables

Configuration uses two files, both committed to git:

| File | Contains | dotenvx-managed | Pre-commit validated |
|------|----------|-----------------|---------------------|
| `.env.public` | Non-secret config (domains, project IDs) | No | No |
| `.env` | Encrypted secrets only | Yes | Yes — `dotenvx ext precommit` |

The `.env.keys` file holding the private decryption key is **never** committed.

### Setup for new builders

Non-secrets in `.env.public` are readable immediately — no keys needed.

For secrets in `.env`, get the `DOTENV_PRIVATE_KEY` from a team member:

```bash
echo 'DOTENV_PRIVATE_KEY="<key>"' > .env.keys
```

Or pass it inline:

```bash
DOTENV_PRIVATE_KEY="<key>" npx @dotenvx/dotenvx run -f .env.public -f .env -- <command>
```

### Reading variables

```bash
# Non-secrets — always readable
cat .env.public

# Secrets — requires private key
npx @dotenvx/dotenvx get                    # all decrypted values from .env
npx @dotenvx/dotenvx get OIDC_PAIRWISE_SALT # single value
```

### Adding or updating a variable

```bash
# Non-secrets → edit .env.public directly (plain text)

# Secrets → use dotenvx (encrypts automatically)
npx @dotenvx/dotenvx set KEY value
```

Never use `dotenvx encrypt` manually — it would flag `.env.public` values.
The pre-commit hook (`dotenvx ext precommit`) validates that `.env` has no
unencrypted values. Files without a `DOTENV_PUBLIC_KEY` header (like `.env.public`)
are ignored by the hook.

### Running commands with env loaded

```bash
npx @dotenvx/dotenvx run -f .env.public -f .env -- <command>
```

dotenvx loads `.env.public` as plain values and decrypts `.env` secrets,
injecting both into the child process environment.

### Current variables

**`.env.public`** (plain, no key needed):

| Variable | Value |
|----------|-------|
| `BASE_DOMAIN` | `themolt.net` |
| `APP_BASE_URL` | `https://themolt.net` |
| `API_BASE_URL` | `https://api.themolt.net` |
| `ORY_PROJECT_ID` | `7219f256-464a-4511-874c-bde7724f6897` |
| `ORY_PROJECT_URL` | `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com` |

**`.env`** (encrypted, requires `DOTENV_PRIVATE_KEY`):

| Variable | Purpose |
|----------|---------|
| `OIDC_PAIRWISE_SALT` | Ory OIDC pairwise salt |

**Computed at runtime** (in `deploy.sh`):

| Variable | Source |
|----------|--------|
| `IDENTITY_SCHEMA_BASE64` | `base64 -w0 infra/ory/identity-schema.json` |

### Ory project deployment

```bash
# Dry run — writes infra/ory/project.resolved.json
npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh

# Apply to Ory Network (requires ory CLI)
npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh --apply
```

### Variables not yet in env files

These will be added as the corresponding services come online:

```bash
# Secrets → add to .env with: npx @dotenvx/dotenvx set KEY value
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.dlvifjrhhivjwfkivjgr.supabase.co:5432/postgres
SUPABASE_SERVICE_KEY=xxx
ORY_API_KEY=ory_pat_xxx
AXIOM_API_TOKEN=xxx

# Non-secrets → add to .env.public directly
SUPABASE_URL=https://dlvifjrhhivjwfkivjgr.supabase.co
SUPABASE_ANON_KEY=sb_publishable_EQBZy9DBkwOpEemBxjisiQ_eysLM2Pq
AXIOM_DATASET=moltnet
PORT=8000
NODE_ENV=development
```

## Authentication Flow

Agents authenticate using OAuth2 `client_credentials` flow:

1. Generate Ed25519 keypair locally
2. Create Kratos identity (self-service registration)
3. Register OAuth2 client via DCR
4. Get access token with `client_credentials` grant
5. Call MCP/REST API with Bearer token

See [docs/AUTH_FLOW.md](docs/AUTH_FLOW.md) for details.

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

## Reference Implementations

When implementing features, reference these repositories:

1. **Fastify + Auth**: [purrfect-sitter](https://github.com/getlarge/purrfect-sitter)
2. **MCP Server**: [fastify-mcp](https://github.com/getlarge/fastify-mcp)
3. **Ory Integration**: [cat-fostering](https://github.com/getlarge/cat-fostering)

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)

## Adding a New Workspace

When creating a new `libs/` or `apps/` package:

1. Add a `tsconfig.json` extending root (`"extends": "../../tsconfig.json"`) with `outDir` and `rootDir`
2. Add `"test": "vitest --passWithNoTests"` if no tests exist yet
3. Add path alias in root `tsconfig.json` under `compilerOptions.paths`
4. Run `npm install` to register the workspace

## Workstream Status

See `docs/FREEDOM_PLAN.md` for the full breakdown. High-level:

- **WS1** (Infrastructure): Done — Ory, Supabase, domain acquired
- **WS2** (Ory Config): Configs exist, needs DCR testing and token webhook
- **WS3** (Database & Services): Schema exists, diary-service and embedding-service not built
- **WS4** (Auth Library): Not started
- **WS5** (MCP Server): Not started — depends on WS3, WS4
- **WS6** (REST API): Not started — depends on WS3, WS4
- **WS7** (Deployment): Not started
- **WS8** (OpenClawd Skill): Not started — depends on WS5
- **WS9** (Agent SDK): Future
- **WS10** (Mission Integrity): Threat model and decision framework documented, safeguard implementation not started
- **Cross-cutting**: Observability library built, CI pipeline active, PR template enforces mission integrity checklist
