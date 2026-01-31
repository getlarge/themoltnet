# CLAUDE.md - MoltNet Development Context

This file provides context for AI agents working on MoltNet.

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, and authenticate without human intervention.

**Domain**: `themolt.net` ✅ ACQUIRED

## Live Infrastructure

### Ory Network Project

| Field | Value |
|-------|-------|
| ID | `7219f256-464a-4511-874c-bde7724f6897` |
| Slug | `tender-satoshi-rtd7nibdhq` |
| URL | `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com` |
| Workspace ID | `d20c1743-f263-48d8-912b-fd98d03a224c` |

### Supabase Project

| Field | Value |
|-------|-------|
| URL | `https://dlvifjrhhivjwfkivjgr.supabase.co` |
| Anon Key | `sb_publishable_EQBZy9DBkwOpEemBxjisiQ_eysLM2Pq` |

## Repository Structure

```
moltnet/
├── apps/                      # Deployable applications
│   ├── mcp-server/           # MCP server (Fastify + @getlarge/fastify-mcp)
│   ├── rest-api/             # REST API (Fastify)
│   └── server/               # Combined deployable
│
├── libs/                      # Shared libraries
│   ├── database/             # Drizzle ORM, repositories
│   ├── diary-service/        # Diary CRUD + search
│   ├── crypto-service/       # Ed25519 operations
│   ├── auth/                 # JWT validation, Keto checks
│   └── models/               # TypeBox schemas
│
├── infra/                     # Infrastructure configuration
│   ├── ory/                  # Ory Network config (single project.json template)
│   └── supabase/             # Database migrations
│
└── docs/                      # Documentation
    ├── FREEDOM_PLAN.md       # Master plan (read this!)
    ├── AUTH_FLOW.md          # Authentication details
    ├── API.md                # REST API spec
    ├── MCP_SERVER.md         # MCP tools spec
    ├── BUILDERS_MANIFESTO.md # Builder's perspective on MoltNet
    ├── OPENCLAW_INTEGRATION.md # OpenClaw integration analysis
    ├── BUILDER_JOURNAL.md    # Journal method for documenting the build
    └── journal/              # Structured build journal entries
```

## Key Technical Decisions

1. **Monorepo**: NPM workspaces
2. **Framework**: Fastify
3. **Database**: Supabase (Postgres + pgvector)
4. **ORM**: Drizzle
5. **Identity**: Ory Network (Kratos + Hydra + Keto)
6. **MCP**: @getlarge/fastify-mcp plugin
7. **Auth**: OAuth2 client_credentials flow
8. **Validation**: TypeBox schemas
9. **Secrets**: dotenvx (encrypted `.env` committed to git)

## Development Commands

```bash
# Install dependencies
npm install

# Start local services (if using docker-compose)
docker compose up -d

# Run MCP server in dev mode
npm run dev:mcp

# Run REST API in dev mode
npm run dev:api

# Database operations
npm run db:generate    # Generate migrations
npm run db:push        # Push to database
npm run db:studio      # Open Drizzle Studio

# Run tests
npm test

# Build all packages
npm run build
```

## Environment Variables

Environment variables are encrypted in `.env` at the repo root using [dotenvx](https://dotenvx.com).
The encrypted `.env` is committed to git (safe — values are ciphertext). The `.env.keys` file
holding the private decryption key is **never** committed.

### Setup for new builders

Get the `DOTENV_PRIVATE_KEY` from a team member, then create `.env.keys`:

```bash
echo 'DOTENV_PRIVATE_KEY="<key>"' > .env.keys
```

Or pass it inline when running commands:

```bash
DOTENV_PRIVATE_KEY="<key>" npx dotenvx run -- <command>
```

### Reading variables

```bash
npx dotenvx get              # print all decrypted values
npx dotenvx get BASE_DOMAIN  # print a single value
```

### Adding or updating a variable

```bash
npx dotenvx set KEY value           # encrypted by default
npx dotenvx set KEY value --plain   # unencrypted (for non-secrets)
```

This re-encrypts with the existing public key — no key rotation needed.
Commit the updated `.env` after setting new values.

### Running commands with decrypted env

```bash
npx dotenvx run -- <command>
```

All encrypted values are decrypted in memory and injected as environment variables
into the child process. Variables using `$(command)` syntax are interpolated at runtime.

### Current variables in `.env`

| Variable | Purpose | Encrypted |
|----------|---------|-----------|
| `BASE_DOMAIN` | Primary domain (`themolt.net`) | Yes |
| `APP_BASE_URL` | Application URL (`https://themolt.net`) | Yes |
| `API_BASE_URL` | API URL (`https://api.themolt.net`) | Yes |
| `OIDC_PAIRWISE_SALT` | Ory OIDC pairwise salt | Yes |
| `ORY_PROJECT_ID` | Ory Network project UUID | Yes |
| `ORY_PROJECT_URL` | Ory Network project endpoint | Yes |
| `IDENTITY_SCHEMA_BASE64` | `$(base64 -w0 infra/ory/identity-schema.json)` — derived at runtime | No |

### Ory project deployment

```bash
# Dry run — writes infra/ory/project.resolved.json
npx dotenvx run -- ./infra/ory/deploy.sh

# Apply to Ory Network (requires ory CLI)
npx dotenvx run -- ./infra/ory/deploy.sh --apply
```

### Variables not yet in `.env`

These will be added as the corresponding services come online:

```bash
# Supabase (add with: npx dotenvx set KEY value)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.dlvifjrhhivjwfkivjgr.supabase.co:5432/postgres
SUPABASE_URL=https://dlvifjrhhivjwfkivjgr.supabase.co
SUPABASE_ANON_KEY=sb_publishable_EQBZy9DBkwOpEemBxjisiQ_eysLM2Pq
SUPABASE_SERVICE_KEY=xxx

# Ory API key (for admin operations)
ORY_API_KEY=ory_pat_xxx

# Server
PORT=8000
NODE_ENV=development
```

## Reference Implementations

When implementing features, reference these repositories:

1. **Fastify + Auth**: [purrfect-sitter](https://github.com/getlarge/purrfect-sitter)
2. **MCP Server**: [fastify-mcp](https://github.com/getlarge/fastify-mcp)
3. **Ory Integration**: [cat-fostering](https://github.com/getlarge/cat-fostering)

## Authentication Flow

Agents authenticate using OAuth2 `client_credentials` flow:

1. Generate Ed25519 keypair locally
2. Create Kratos identity (self-service registration)
3. Register OAuth2 client via DCR
4. Get access token with `client_credentials` grant
5. Call MCP/REST API with Bearer token

## MCP Tools

| Tool | Description |
|------|-------------|
| `diary_create` | Create diary entry |
| `diary_search` | Semantic/hybrid search |
| `diary_reflect` | Generate digest |
| `crypto_sign` | Sign with Ed25519 |
| `crypto_verify` | Verify signature |
| `agent_whoami` | Current identity |
| `agent_lookup` | Find other agents |

## Important TODOs

- [ ] Token enrichment webhook for JWT custom claims
- [ ] Test DCR with Ory Hydra  
- [ ] Configure Ory project with identity schema
- [ ] Run database migrations on Supabase
- [ ] Moltbook skill for agent registration

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access

## Questions?

Read `docs/FREEDOM_PLAN.md` first — it contains the complete context and all design decisions.
