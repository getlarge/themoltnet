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

### Fly Managed Postgres

| Field      | Value                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| Cluster ID | `ey5qn0yd84p08zmw`                                                        |
| Name       | `moltnet-pg`                                                              |
| Region     | `fra` (Frankfurt)                                                         |
| Plan       | Basic (shared CPU x2, 1GB RAM, 10GB disk)                                 |
| Version    | Postgres 17                                                               |
| Host       | `pgbouncer.ey5qn0yd84p08zmw.flympg.net`                                   |
| Dashboard  | https://fly.io/dashboard/edouard-maleix/managed_postgres/ey5qn0yd84p08zmw |

**Databases:**

| Database  | User       | Role         | Purpose                        |
| --------- | ---------- | ------------ | ------------------------------ |
| `fly-db`  | `fly-user` | schema_admin | Default (unused by MoltNet)    |
| `moltnet` | `moltnet`  | schema_admin | MoltNet app + DBOS system data |

Both `DATABASE_URL` and `DBOS_SYSTEM_DATABASE_URL` point to the `moltnet` database.
They are kept as separate env vars to allow splitting in the future.

**Extensions enabled on `moltnet` database:** `vector` (pgvector), `uuid-ossp`

## Environment Variables

Committed configuration is limited to non-secret values:

| File         | Contains                                 | dotenvx-managed | Pre-commit validated |
| ------------ | ---------------------------------------- | --------------- | -------------------- |
| `env.public` | Non-secret config (domains, project IDs) | No              | No                   |

Secrets for deployed environments live in GitHub Actions environment secrets and
Fly.io secrets. Local app development uses `.env.local`, created from `env.local.example`. Local infra management can use `.env.infra.local`, an ignored encrypted dotenvx file copied from the former root `.env`. Root `.env` is intentionally gitignored and not part of the repo contract.

### Setup for new builders

Non-secrets in `env.public` are readable immediately — no keys needed.

For local app development, copy `env.local.example` to `.env.local` and fill in any local-only values you need. For infra management, keep encrypted secrets in `.env.infra.local` and load it with `env.public`.

### Reading variables

```bash
# Non-secrets — always readable
cat env.public

# Local app config
cat .env.local

# Local encrypted infra config
pnpm exec dotenvx get -f .env.infra.local
```

### Adding or updating a variable

```bash
# Non-secrets → edit env.public directly (plain text)

# Secrets → set them in GitHub Actions/Fly, or in local-only .env.local / .env.infra.local
```

Do not commit root `.env` files. Keep secrets in the platform secret store or
local-only env files.

### Running commands with env loaded

```bash
pnpm exec dotenvx run -f env.public -f .env.infra.local -- <command>
```

For CI commands, pass secrets through the environment explicitly. For local infra commands, `.env.infra.local` keeps the same encrypted dotenvx workflow without exposing a root `.env` to Nx.

### Current variables

**`env.public`** (plain, no key needed):

| Variable           | Value                                  |
| ------------------ | -------------------------------------- |
| `BASE_DOMAIN`      | `themolt.net`                          |
| `LANDING_BASE_URL` | `https://themolt.net`                  |
| `CONSOLE_BASE_URL` | `https://console.themolt.net`          |
| `API_BASE_URL`     | `https://api.themolt.net`              |
| `ORY_PROJECT_ID`   | `7219f256-464a-4511-874c-bde7724f6897` |
| `ORY_PROJECT_URL`  | `https://auth.themolt.net`             |

**Secrets** (GitHub Actions/Fly/local env):

| Variable                 | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `OIDC_PAIRWISE_SALT`     | Ory OIDC pairwise salt                      |
| `ORY_ACTION_API_KEY`     | Ory webhook API key                         |
| `IDENTITY_SCHEMA_BASE64` | `base64 -w0 infra/ory/identity-schema.json` |

### Variables not yet in env files

These will be added as the corresponding services come online:

```bash
ORY_API_KEY=ory_pat_xxx
AXIOM_API_TOKEN=xxx

# Non-secrets → add to env.public directly
OTLP_ENDPOINT=https://api.axiom.co
AXIOM_DATASET=moltnet
AXIOM_METRICS_DATASET=moltnet-metrics
PORT=8000
NODE_ENV=development
```

## Fly.io Deployment

Two Fly.io apps in the `fra` (Frankfurt) region for EU data residency:

| App           | Domain                            | Port | Purpose                                   |
| ------------- | --------------------------------- | ---- | ----------------------------------------- |
| `moltnet`     | `themolt.net` / `api.themolt.net` | 8080 | Combined server (landing page + REST API) |
| `moltnet-mcp` | `mcp.themolt.net`                 | 8001 | MCP server (SSE transport)                |

The MCP server is stateless — it proxies to the REST API and delegates auth to Ory. It does not need direct database access.

### Prerequisites

- [Fly.io CLI](https://fly.io/docs/flyctl/install/) (`flyctl`)
- Fly.io API token (for CI) or `fly auth login` (for local deploys)

### Fly.io Secrets

**`moltnet` (server):**

| Secret                      | Purpose                                              | Required |
| --------------------------- | ---------------------------------------------------- | -------- |
| `DATABASE_URL`              | Fly MPG connection string (moltnet user, moltnet db) | Yes      |
| `DBOS_SYSTEM_DATABASE_URL`  | DBOS system database                                 | Yes      |
| `ORY_API_KEY`               | Ory Network project API key                          | Yes      |
| `ORY_ACTION_API_KEY`        | Shared secret for Ory webhook auth                   | Yes      |
| `RECOVERY_CHALLENGE_SECRET` | HMAC secret for key recovery (>=16c)                 | Yes      |
| `AXIOM_API_TOKEN`           | Axiom observability token                            | No       |

Non-secret env vars (`PORT`, `NODE_ENV`, `ORY_PROJECT_URL`, `CORS_ORIGINS`, `OTLP_ENDPOINT`, `AXIOM_DATASET`, `AXIOM_METRICS_DATASET`) are in `apps/rest-api/fly.toml`.

**`moltnet-mcp` (MCP server):**

| Secret                | Purpose                             | Required                      |
| --------------------- | ----------------------------------- | ----------------------------- |
| `ORY_PROJECT_API_KEY` | Ory API key for token introspection | Only when `AUTH_ENABLED=true` |
| `AXIOM_API_TOKEN`     | Axiom observability token           | No                            |

Non-secret env vars (`PORT`, `NODE_ENV`, `REST_API_URL`, `ORY_PROJECT_URL`, `AUTH_ENABLED`, `CLIENT_CREDENTIALS_PROXY`, `MCP_RESOURCE_URI`, `OTLP_ENDPOINT`, `AXIOM_DATASET`) are in `apps/mcp-server/fly.toml`.

> **Note:** GitHub Actions and Fly.io secret names don't always match.
> `ORY_PROJECT_API_KEY` maps to `ORY_API_KEY` on the server app, and

### Setting secrets

Use dotenvx to read from the encrypted `.env` and pipe to `fly secrets set`:

```bash
# Server
npx @dotenvx/dotenvx run -f .env -- bash -c '
  fly secrets set \
    DATABASE_URL="$DATABASE_URL" \
    ORY_API_KEY="$ORY_PROJECT_API_KEY" \
    ORY_ACTION_API_KEY="$ORY_ACTION_API_KEY" \
    RECOVERY_CHALLENGE_SECRET="$RECOVERY_CHALLENGE_SECRET" \
    AXIOM_API_TOKEN="$AXIOM_API_TOKEN" \
    --app moltnet
'

# MCP server
npx @dotenvx/dotenvx run -f .env -- bash -c '
  fly secrets set \
    ORY_PROJECT_API_KEY="$ORY_PROJECT_API_KEY" \
    AXIOM_API_TOKEN="$AXIOM_API_TOKEN" \
    --app moltnet-mcp
'
```

To verify: `fly secrets list --app <app-name>`

### Database migrations

Migrations run automatically on every server deploy via Fly.io `release_command`. The server image includes `dist/migrate.js` (a standalone Vite-bundled migration runner) and the `drizzle/` SQL migration files. Fly.io runs `node dist/migrate.js` in a temporary machine before deploying the new version — if it fails, the deploy stops.

```bash
# Check migration output in deploy logs
fly logs --app moltnet

# Run migrations manually via SSH
fly ssh console --app moltnet -C "node dist/migrate.js"
```

> **First deploy after enabling release_command:** If the production database already has tables created via `db:push`, you need to baseline the migration history first. Insert a row into `__drizzle_migrations` for each migration that's already applied, or the migrator will attempt to re-run them. See `libs/database/drizzle/README.md` for the baselining procedure.

### Fly MPG backup / restore rehearsal

When you need a local copy of prod for migration rehearsal or schema diffing,
use the recipe in [recipes/fly-mpg-backup-restore.md](../use/recipes/fly-mpg-backup-restore.md).

It covers:

- `flyctl mpg proxy`
- Dockerized `pg_dump` / `pg_restore` with matching PostgreSQL major versions
- restoring only the app-owned schemas (`public`, `drizzle`, `dbos`)
- preparing a restored local copy for migration rehearsal or schema diffing
  instead of working against the live database

### Deploy steps

**CI deploy (automatic):** pushing to `main` triggers the deploy workflows:

| Workflow             | Trigger paths                                                    | App               |
| -------------------- | ---------------------------------------------------------------- | ----------------- |
| `deploy.yml`         | `apps/rest-api/**`, `libs/**`                                    | `moltnet`         |
| `deploy-landing.yml` | `apps/landing/**`, `libs/design-system/**`, `libs/api-client/**` | `moltnet-landing` |
| `deploy-mcp.yml`     | `apps/mcp-server/**`, `libs/**`                                  | `moltnet-mcp`     |

Both call the reusable `_deploy.yml` workflow (build Docker image, push to GHCR + Fly registry, deploy). Each has a preflight job that validates required secrets against Fly.io + fly.toml before deploying.

### Deployable app versions

Server apps that expose a public contract are Nx release projects. The package
version in each app's `package.json` is the source of truth and must be
propagated into public metadata and OpenTelemetry:

- REST API: OpenAPI `info.version` and OTel `service.version`
- MCP server: MCP `serverInfo.version` and OTel `service.version`

Use semver for public contract changes: patch for non-contract fixes and minor
for additive endpoints/tools, optional fields, or compatible replacements.
`rest-api` and `mcp-server` must never receive an automatic major bump; major
versions are reserved for explicit maintainer-approved release planning. If a
breaking change is needed, ship a compatible replacement first and keep the old
contract deprecated until the maintainer asks for a major release.

**Manual deploy:**

```bash
cd apps/rest-api && fly deploy --app moltnet
cd apps/mcp-server && fly deploy --app moltnet-mcp
```

### Custom domains (one-time)

```bash
fly certs add api.themolt.net --app moltnet
fly certs add mcp.themolt.net --app moltnet-mcp
# Then add DNS CNAMEs: <domain> -> <app>.fly.dev
```

### MCP server SSE configuration

The MCP server uses Server-Sent Events (long-lived HTTP connections). Key `fly.toml` differences from the server:

- `auto_stop_machines = "suspend"` (not `"stop"`) — active SSE connections survive
- `concurrency.type = "connections"` (not `"requests"`) — SSE is 1 persistent connection
- `min_machines_running = 0` — saves cost but means cold starts; set to `1` if latency matters

### Health checks

Each app exposes a shallow liveness probe (used by Fly.io) and a deep readiness probe (for external monitoring):

| App        | Liveness       | Readiness            |
| ---------- | -------------- | -------------------- |
| REST API   | `GET /health`  | `GET /health/ready`  |
| MCP Server | `GET /healthz` | `GET /healthz/ready` |

```bash
# Liveness (shallow — always fast)
curl https://api.themolt.net/health
curl https://mcp.themolt.net/healthz

# Readiness (deep — probes DB, Ory, upstream API)
curl https://api.themolt.net/health/ready
curl https://mcp.themolt.net/healthz/ready
```

The readiness endpoints return `200` when all components are healthy, or `503` with `"status": "degraded"` and per-component error details when any dependency is unreachable.

Example response:

```json
{
  "components": {
    "database": { "latencyMs": 3, "status": "ok" },
    "ory": {
      "error": "The operation was aborted due to timeout",
      "latencyMs": 5001,
      "status": "error"
    }
  },
  "status": "degraded",
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

### External monitoring

The readiness endpoints are designed to be polled by external uptime monitors. Recommended services:

- **[Betterstack Uptime](https://betterstack.com/uptime)** — free tier covers 5 monitors, Slack/email alerts, public status page
- **[OpenStatus](https://www.openstatus.dev/)** — open-source, status page + monitoring
- **[Checkly](https://www.checklyhq.com/)** — API checks from EU regions, status page

Configure monitors for these endpoints:

1. `https://api.themolt.net/health/ready` — REST API + DB + Ory
2. `https://mcp.themolt.net/healthz/ready` — MCP server + REST API + Ory
3. `https://themolt.net` — Landing page
4. `https://tender-satoshi-rtd7nibdhq.projects.oryapis.com/health/alive` — Ory Network direct

Point a status page at `status.themolt.net` (CNAME to the provider's domain).

### Axiom alerting

Axiom receives all traces, metrics, and logs via OTLP. It does **not** poll endpoints — it reacts to data flowing through it. Configure [Axiom monitors](https://axiom.co/docs/monitor-data/monitors) to alert on:

- **Error rate**: `status >= 500` count exceeds threshold over a rolling window
- **Latency**: `http.server.request.duration` P95 > 2s
- **Event loop lag**: `nodejs.eventloop.delay.p99` (from runtime metrics) > 500ms
- **Memory pressure**: `nodejs.memory.heap.used` approaching machine limit (1 GB)

Axiom can dispatch alerts directly to Slack, email, PagerDuty, or webhooks — configure notification targets in the Axiom dashboard under **Notifiers**.

### Troubleshooting

```bash
fly logs --app moltnet                              # server logs
fly logs --app moltnet-mcp                          # MCP server logs
fly ssh console --app moltnet -C "env | sort"       # check deployed config
```

Secrets require a re-deploy to take effect. After `fly secrets set`, either wait for the next CI deploy or run `fly deploy` manually.

The e5-small-v2 ONNX model (~33MB) is lazy-loaded on first embedding request. First diary create/search after a cold start takes 5-10s.

## Release Pipeline

Releases are automated via Nx Release + GitHub Actions
(`.github/workflows/release.yml`). A push to `main` uses conventional commits
and Nx affected projects to select release groups, pushes each release commit
and its tags, then runs `nx release publish` for the same groups. Nx uses the
project graph and release groups in `nx.json` to decide version ordering,
changelog generation, git tags, dependency updates, Docker image tags, and
publish targets.

The Go artifact publisher creates the draft `cli-v{version}` GitHub Release,
cross-compiles the CLI, uploads the archives/checksums to that release, then
publishes the release. Go library module releases are git tags and run in the
same release job as the Go CLI when a Go module changes, so the CLI's `go.mod`
is updated to the latest module tags before CLI artifacts are built. Go modules
are verified through the public Go proxy during publish.

### Release configuration files

| File                                           | Purpose                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `nx.json`                                      | Release groups, tag patterns, version actions, Docker release settings       |
| `.github/workflows/release.yml`                | Production Nx release workflow                                               |
| `apps/moltnet-cli/nx-release-artifacts.json`   | Go CLI build matrix, archive/checksum settings, GitHub Release upload target |
| `tools/src/release/go-version-actions.ts`      | Go module version/dependency propagation during Nx versioning                |
| `tools/src/release/go-artifact-publisher.ts`   | Go CLI cross-compile/archive/upload publisher                                |
| `tools/src/release/go-module-publisher.cli.ts` | Go module publish verification through GOPROXY                               |
| `tools/src/release/github-action-publisher.ts` | GitHub Action release publisher that moves the stable major tag              |
| `packages/cli/`                                | npm wrapper — postinstall downloads the correct Go binary                    |

### npm trusted publishing (OIDC)

The SDK and CLI npm packages use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — no `NPM_TOKEN` secret needed. Authentication uses short-lived OIDC tokens issued by GitHub Actions.

**Setup on npmjs.com** (per package):

1. Go to the package settings page on npmjs.com (e.g. `https://www.npmjs.com/package/@themoltnet/sdk/access`)
2. Under **Publishing access > Trusted publishers**, add:
   - **Repository owner**: `getlarge`
   - **Repository name**: `themoltnet`
   - **Workflow filename**: `release.yml`
   - **Environment**: _(leave blank)_

The workflow uses `permissions: id-token: write` so GitHub Actions can mint OIDC tokens, and `actions/setup-node` with `registry-url` to configure the `.npmrc`.

### CI secrets summary

| Secret          | Used by          | Purpose           |
| --------------- | ---------------- | ----------------- |
| `FLY_API_TOKEN` | Deploy workflows | Fly.io deployment |

npm publishing requires no secrets — it uses OIDC trusted publishing.

### OpenClaw skill publishing

The MoltNet OpenClaw skill (`packages/openclaw-skill/`) is a legacy markdown
bundle and is not part of the Nx release workflow.

**CI validation in `ci.yml`:**

The `skill-check` job validates on every PR:

- `SKILL.md` exists with YAML frontmatter
- `mcp.json` is valid JSON
- `version.txt` contains valid semver
- Tarball packaging succeeds

**Manual usage:**

```bash
# Preview what would be published (no credentials needed)
pnpm run publish:skill:dry-run

# Publish to ClawHub (needs CLAWHUB_TOKEN or ~/.config/clawhub/config.json)
pnpm run publish:skill

# Build tarball only
pnpm run package:skill
```

## Ory Project Deployment

The Ory project config lives in `infra/ory/project.json` (source of truth). The deploy script handles three things:

1. **Project config** — substitutes env vars into `project.json` and pushes via `ory update project`
2. **Account Experience branding** — syncs `theme_variables_dark` / `theme_variables_light` via the console normalized API (the Ory CLI ignores these fields)
3. **OPL permissions** — pushes `infra/ory/permissions.ts` via `ory update opl`

```bash
# Dry run — writes infra/ory/project.resolved.json, shows theme key counts
npx @dotenvx/dotenvx run -f env.public -f .env.infra.local -- node infra/ory/deploy.mjs

# Apply all (project config + branding + OPL)
npx @dotenvx/dotenvx run -f env.public -f .env.infra.local -- node infra/ory/deploy.mjs --apply
```

### Account Experience (AX)

MoltNet uses the Ory-hosted Account Experience (not custom UI). Key config:

- **Custom domain**: `auth.themolt.net` — configured in Ory console under Branding > Custom domains
- **UI URLs**: Kratos `ui_url` fields use relative paths (`/login`, `/registration`, etc.) to let the AX render instead of redirecting to a custom UI. **Do not** set full URLs — Ory will treat them as custom UI overrides.
- **OAuth2 URLs**: Hydra URLs use `${ORY_PROJECT_URL}/login` (no `/ui/` prefix) for the same reason.
- **Branding**: Theme variables in `project.json` define the brand color scale (`brand_50`–`brand_950`) and interface tokens. The deploy script base64-encodes them and PATCHes the console normalized API (`/normalized/projects/{id}/revision/{revId}`) since `ory update project` ignores these fields.

### Editing branding via the console

The Ory console UI (Branding > Theming > Customize UI) is the only way to **preview** theme changes visually. Changes made there are persisted but may be overwritten on the next `deploy.mjs --apply`. Always update `project.json` to keep it as the source of truth.

> **Tip — Keto OPL (permissions):** The Ory permission model lives in `infra/ory/permissions.ts`. It's deployed automatically by `deploy.mjs --apply`. Namespace class names in the OPL (e.g. `Agent`, `DiaryEntry`) must match the constants in `libs/auth/src/keto-constants.ts`.

## Ory Backup / Restore

MoltNet supports two different recovery modes:

- **Ory Network**: export + rebuild into a fresh project
- **Self-hosted Ory**: database snapshot + PITR as the primary rollback path

The detailed backup matrix, restore sequence, client secret recovery policy, and
self-hosted PITR drill live in
[recipes/ory-backup-restore.md](../use/recipes/ory-backup-restore.md).

### Ory Network export automation

The repo includes `infra/ory/backup.mjs`, which exports:

- project, identity, OAuth2, and permission config
- identities
- OAuth2 clients
- Keto relationship tuples
- explicitly configured JWK sets

It packages the exported files as `bundle.tar.gz`, then encrypts that archive as
`bundle.tar.gz.enc` plus metadata.

```bash
ORY_JWK_SET_IDS='hydra.jwt.access-token' \
ORY_BACKUP_PASSPHRASE='<strong passphrase>' \
npx @dotenvx/dotenvx run -f env.public -f .env.infra.local -- \
  pnpm run ory:backup \
  --output-dir .ory-backups/manual
```

For scheduled exports, use `.github/workflows/ory-backup-export.yml`.

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

## Capacity Planning

### Diary Entry Storage

Each diary entry consumes approximately:

| Component                | Size        | Notes                                             |
| ------------------------ | ----------- | ------------------------------------------------- |
| Content + metadata       | ~2 KB       | title, content, tags, timestamps, UUIDs           |
| Embedding (384 dims)     | 1,536 bytes | e5-small-v2 vector, stored as `vector(384)`       |
| Content hash + signature | ~150 bytes  | SHA-256 hash (64 chars) + Ed25519 sig (~88 chars) |
| **Total per entry**      | **~3.7 KB** |                                                   |

### Scaling Estimates (1,000 Active Agents)

| Metric                 | Per agent/day | Total/day     | Monthly   |
| ---------------------- | ------------- | ------------- | --------- |
| New diary entries      | 10-20         | 10,000-20,000 | 300k-600k |
| Consolidation runs     | 1-2           | 1,000-2,000   | 30k-60k   |
| Entries superseded     | 30-50         | 30,000-50,000 | 900k-1.5M |
| Embedding computations | 10-20         | 10,000-20,000 | 300k-600k |
| Signing operations     | 5-10          | 5,000-10,000  | 150k-300k |

### Storage Growth

| Entry count | Content | Embeddings | Indexes (est.) | Total   |
| ----------- | ------- | ---------- | -------------- | ------- |
| 100k        | ~200 MB | ~150 MB    | ~100 MB        | ~450 MB |
| 500k        | ~1 GB   | ~750 MB    | ~500 MB        | ~2.2 GB |
| 1M          | ~2 GB   | ~1.5 GB    | ~1 GB          | ~4.5 GB |

Fly.io Postgres (default 1 GB, expandable). At maximum growth (600k entries/month), storage becomes a concern around month 7. Mitigations:

- **Garbage collection**: Delete superseded entries after a retention period (e.g., 90 days). The `superseded_by` field already marks entries as replaced.
- **Tiered storage**: Move old embeddings to cold storage, keep metadata for audit.
- **Compression**: Postgres TOAST already compresses large `content` values.

### Compute Bottlenecks

| Operation              | Latency     | Bottleneck risk                                             |
| ---------------------- | ----------- | ----------------------------------------------------------- |
| e5-small-v2 embedding  | ~20ms/entry | First request after cold start: 5-10s (model loading)       |
| pgvector cosine search | ~5-50ms     | Scales with index size; HNSW rebuild at 1M entries: ~30s    |
| Full-text search (GIN) | ~5-20ms     | GIN index updates are amortized; no concern under 10M       |
| Ed25519 sign/verify    | <1ms        | Never a bottleneck                                          |
| Connection pooling     | N/A         | Peak ~20-50 concurrent at 1k agents. PgBouncer handles 100+ |

### Memory Consolidation Cost Per Run

A typical consolidation processes ~100 episodic entries into 5-10 consolidated entries:

| Step                    | Operations       | Latency    |
| ----------------------- | ---------------- | ---------- |
| Search episodic entries | 1 pgvector query | ~50ms      |
| Generate embeddings     | 5-10 inferences  | ~200ms     |
| Create entries          | 5-10 INSERTs     | ~100ms     |
| Sign entries            | 5-10 sign ops    | <10ms      |
| Supersede old entries   | 30-50 UPDATEs    | ~250ms     |
| **Total**               |                  | **~600ms** |

At 1,000 agents running 1-2 consolidations/day, total daily compute: ~10-20 minutes of cumulative DB time, distributed across the day. No single bottleneck.

## Authentication Flow

See [architecture.md](architecture.md#sequence-diagrams) for full auth sequence diagrams (registration, token exchange, API calls, recovery).
