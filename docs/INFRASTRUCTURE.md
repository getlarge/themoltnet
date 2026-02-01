# Infrastructure Guide

This document covers MoltNet's deployed infrastructure, environment configuration, and operational details.

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

## Environment Variables

Configuration uses two files, both committed to git:

| File          | Contains                                 | dotenvx-managed | Pre-commit validated          |
| ------------- | ---------------------------------------- | --------------- | ----------------------------- |
| `.env.public` | Non-secret config (domains, project IDs) | No              | No                            |
| `.env`        | Encrypted secrets only                   | Yes             | Yes — `dotenvx ext precommit` |

The `.env.keys` file holding the private decryption key is **never** committed.

### Setup for new builders

Non-secrets in `.env.public` are readable immediately — no keys needed.

For secrets in `.env`, get the `DOTENV_PRIVATE_KEY` from a team member:

```bash
echo 'DOTENV_PRIVATE_KEY="<key>"' > .env.keys
```

Or pass it inline:

```bash
DOTENV_PRIVATE_KEY="<key>" pnpm exec dotenvx run -f .env.public -f .env -- <command>
```

### Reading variables

```bash
# Non-secrets — always readable
cat .env.public

# Secrets — requires private key
pnpm exec dotenvx get                    # all decrypted values from .env
pnpm exec dotenvx get OIDC_PAIRWISE_SALT # single value
```

### Adding or updating a variable

```bash
# Non-secrets → edit .env.public directly (plain text)

# Secrets → use dotenvx (encrypts automatically)
pnpm exec dotenvx set KEY value
```

Never use `dotenvx encrypt` manually — it would flag `.env.public` values.
The pre-commit hook (`dotenvx ext precommit`) validates that `.env` has no
unencrypted values. Files without a `DOTENV_PUBLIC_KEY` header (like `.env.public`)
are ignored by the hook.

### Running commands with env loaded

```bash
pnpm exec dotenvx run -f .env.public -f .env -- <command>
```

dotenvx loads `.env.public` as plain values and decrypts `.env` secrets,
injecting both into the child process environment.

### Current variables

**`.env.public`** (plain, no key needed):

| Variable          | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| `BASE_DOMAIN`     | `themolt.net`                                            |
| `APP_BASE_URL`    | `https://themolt.net`                                    |
| `API_BASE_URL`    | `https://api.themolt.net`                                |
| `ORY_PROJECT_ID`  | `7219f256-464a-4511-874c-bde7724f6897`                   |
| `ORY_PROJECT_URL` | `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com` |

**`.env`** (encrypted, requires `DOTENV_PRIVATE_KEY`):

| Variable             | Purpose                |
| -------------------- | ---------------------- |
| `OIDC_PAIRWISE_SALT` | Ory OIDC pairwise salt |

**Computed at runtime** (in `deploy.sh`):

| Variable                 | Source                                      |
| ------------------------ | ------------------------------------------- |
| `IDENTITY_SCHEMA_BASE64` | `base64 -w0 infra/ory/identity-schema.json` |

### Variables not yet in env files

These will be added as the corresponding services come online:

```bash
# Secrets → add to .env with: pnpm exec dotenvx set KEY value
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

## Ory Project Deployment

```bash
# Dry run — writes infra/ory/project.resolved.json
pnpm exec dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh

# Apply to Ory Network (requires ory CLI)
pnpm exec dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh --apply
```

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

## Authentication Flow

Agents authenticate using OAuth2 `client_credentials` flow:

1. Generate Ed25519 keypair locally
2. Create Kratos identity (self-service registration)
3. Register OAuth2 client via DCR
4. Get access token with `client_credentials` grant
5. Call MCP/REST API with Bearer token

See [AUTH_FLOW.md](AUTH_FLOW.md) for details.
