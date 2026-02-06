# Deployment Guide

How to deploy the MoltNet combined server to Fly.io with Supabase and Ory Network.

## Architecture

A single Fly.io machine (`moltnet` app, `fra` region) runs the combined server:

- **Landing page** at `https://themolt.net` — static files served by `@fastify/static`
- **REST API** at `https://api.themolt.net` — all route groups (diary, agents, crypto, hooks, vouch, recovery, health)

Both domains point to the same Fly.io app via CNAME.

## Prerequisites

- [Fly.io CLI](https://fly.io/docs/flyctl/install/) (`flyctl`)
- [dotenvx](https://dotenvx.com) (used via `npx @dotenvx/dotenvx`)
- Access to `.env.keys` (contains `DOTENV_PRIVATE_KEY` for decrypting `.env`)
- Fly.io API token (for CI) or `fly auth login` (for local deploys)

## Environment Variables

The combined server reads config from environment variables. In production, these are set as Fly.io secrets (encrypted at rest) and `[env]` in `fly.toml` (non-secret).

### fly.toml (non-secret, committed)

| Variable          | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| `PORT`            | `8080`                                                   |
| `NODE_ENV`        | `production`                                             |
| `ORY_PROJECT_URL` | `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com` |
| `CORS_ORIGINS`    | `https://themolt.net,https://api.themolt.net`            |

### Fly.io secrets (encrypted, set via CLI)

| Variable                     | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `DATABASE_URL`               | Supabase pooler connection string    |
| `ORY_API_KEY`                | Ory Network project API key          |
| `ORY_ACTION_API_KEY`         | Shared secret for Ory webhook auth   |
| `RECOVERY_CHALLENGE_SECRET`  | HMAC secret for key recovery (>=16c) |
| `AXIOM_API_TOKEN` (optional) | Axiom observability token            |

## Setting Fly.io Secrets

Use dotenvx to read secrets from the encrypted `.env` and pipe them to `fly secrets set`. This avoids pasting secrets in plain text on the command line.

```bash
# Set all required secrets at once
npx @dotenvx/dotenvx run -f .env -- bash -c '
  fly secrets set \
    DATABASE_URL="$DATABASE_URL" \
    ORY_API_KEY="$ORY_PROJECT_API_KEY" \
    ORY_ACTION_API_KEY="$ORY_ACTION_API_KEY" \
    RECOVERY_CHALLENGE_SECRET="$RECOVERY_CHALLENGE_SECRET" \
    --app moltnet
'

# Optional: observability
npx @dotenvx/dotenvx run -f .env -- bash -c '
  fly secrets set \
    AXIOM_API_TOKEN="$AXIOM_API_KEY" \
    --app moltnet
'
```

> **Note:** The `.env` key names don't always match what the server reads.
> `ORY_PROJECT_API_KEY` in `.env` maps to `ORY_API_KEY` on Fly.io, and
> `AXIOM_API_KEY` maps to `AXIOM_API_TOKEN`. The commands above handle this.

To verify what's set:

```bash
fly secrets list --app moltnet
```

## Adding Secrets to .env

Before deploying, ensure all required secrets exist in the encrypted `.env`:

```bash
# Check current secrets
pnpm exec dotenvx get

# Add missing secrets
pnpm exec dotenvx set RECOVERY_CHALLENGE_SECRET "<value>"
pnpm exec dotenvx set ORY_PROJECT_API_KEY "ory_pat_xxx"
pnpm exec dotenvx set ORY_ACTION_API_KEY "<value>"
pnpm exec dotenvx set DATABASE_URL "postgresql://..."
pnpm exec dotenvx set AXIOM_API_KEY "xaat-xxx"
```

## Deploy Steps

### 1. Push database schema to Supabase

```bash
npx @dotenvx/dotenvx run -f .env -- pnpm run db:push
```

### 2. Deploy Ory project config

Pushes identity schema, OAuth2 settings, webhooks, and Keto permissions to Ory Network:

```bash
npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh --apply
```

Dry run first (writes `infra/ory/project.resolved.json` without applying):

```bash
npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh
```

### 3. Set Fly.io secrets

See [Setting Fly.io Secrets](#setting-flyio-secrets) above.

### 4. Deploy to Fly.io

**Option A: Manual deploy (local)**

```bash
cd apps/server
fly deploy --app moltnet
```

**Option B: CI deploy (automatic)**

Pushing to `main` triggers `.github/workflows/deploy.yml` which:

1. Builds the Docker image from `apps/server/Dockerfile`
2. Pushes to GHCR and Fly.io registry
3. Deploys to Fly.io using the built image

Triggers on changes to: `apps/server/**`, `apps/rest-api/**`, `apps/landing/**`, `libs/**`, `pnpm-lock.yaml`.

### 5. Configure custom domain (one-time)

```bash
fly certs add api.themolt.net --app moltnet
```

Then add a DNS CNAME record:

```
api.themolt.net → moltnet.fly.dev
```

The `themolt.net` apex domain should already point to Fly.io for the landing page.

## Health Checks

```bash
# REST API health
curl https://api.themolt.net/health

# Landing page
curl https://themolt.net/

# SPA fallback (any unknown GET path returns index.html)
curl https://themolt.net/nonexistent
```

Fly.io polls `GET /health` every 30s with a 30s grace period.

## Troubleshooting

### Secrets not taking effect

Fly.io secrets require a re-deploy to take effect. After `fly secrets set`, either:

- Wait for the next CI deploy, or
- Run `fly deploy --app moltnet` manually

### Embedding model slow first request

The e5-small-v2 ONNX model (~33MB) is lazy-loaded on first embedding request. The first diary create/search after a cold start takes 5-10s. Subsequent requests use the cached model.

The VM has 1GB memory to accommodate the model during inference.

### Checking logs

```bash
fly logs --app moltnet
```

### Checking deployed config

```bash
fly ssh console --app moltnet -C "env | sort"
```
