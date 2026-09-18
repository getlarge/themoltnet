# Infrastructure Guide

## Deployment ownership

This public repository defines product architecture, application configuration
contracts, schemas, migrations, and deployable artifacts. Exact live-provider
inventory, operator commands, verification queries, recovery procedures, and
credential administration are maintained privately.

`DATABASE_URL` and `DBOS_SYSTEM_DATABASE_URL` remain separate application
contracts even when a deployment points them at the same PostgreSQL database.
The product requires the `vector` and `uuid-ossp` extensions.

## Environment Variables

Committed configuration is limited to non-secret values:

| File         | Contains                                  | dotenvx-managed | Pre-commit validated |
| ------------ | ----------------------------------------- | --------------- | -------------------- |
| `env.public` | Non-secret product endpoints and defaults | No              | No                   |

Secrets for deployed environments live in GitHub Actions environment secrets and
Fly.io secrets. Local app development uses `.env.local`, created from
`env.local.example`. Local infra management can use `.env.infra.local`, an
ignored encrypted dotenvx file copied from the former root `.env`. Root `.env`
is intentionally gitignored and not part of the repo contract.

### Setup for new builders

Non-secrets in `env.public` are readable immediately; no keys needed.

For local app development, copy `env.local.example` to `.env.local` and fill in
any local-only values you need. For infra management, keep encrypted secrets in
`.env.infra.local` and load it with `env.public`.

### Configuration contract

`env.public` contains only public application endpoints and defaults. Local
development uses `.env.local`; local infrastructure tooling may use the ignored
`.env.infra.local`. Provider project identifiers and live credentials belong in
protected deployment environments, not committed configuration.

Do not commit root `.env` files or print resolved infrastructure environments.
Application code should consume named variables without assuming a particular
provider account, project, cluster, or secret store.

## Local Ory Talos

The development Compose stack runs Ory Talos OSS on `http://localhost:4420`.
Copy `env.local.example` to `.env.local`, then start infrastructure normally:

```bash
docker compose --env-file .env.local up -d talos
```

Talos migrates its SQLite database before starting. Local development mounts the
named `talos-data` volume at `/var/lib/talos`, so issued keys survive a
container restart. `docker compose down -v` removes that data.

The Talos image declares `/var/lib/talos` as a volume, so the e2e/CI Compose
service explicitly replaces it with a non-root-owned `tmpfs`. Its SQLite
database and runtime secrets therefore disappear with the container and cannot
reuse the development `talos-data` volume. The container generates its private
signing JWK and HMAC secret at startup, then supplies them through Talos's
runtime configuration environment variables. Development keeps them in
`talos-data`; e2e/CI regenerates them with each fresh container. No private
Talos key material is committed to the repository.

Set `ORY_TALOS_ADMIN_URL` on the REST API to enable Talos-key authentication.
Managed Ory deployments reuse the existing `ORY_API_KEY`; local OSS does not
require one. Talos administration remains server-side: agents and browsers never
receive its admin client or access token, and the admin endpoint must not be
exposed outside a trusted service network in production.

Successful Talos verification, OAuth introspection, and Kratos session
resolution are cached in each REST API process for 60 seconds by default.
`ORY_AUTH_CACHE_TTL_MS=0` disables persistent entries while retaining
single-flight request coalescing; `ORY_AUTH_CACHE_MAX_ENTRIES` bounds the
process-local LRU. Entries never contain raw credentials as keys.
`ORY_AUTH_REQUEST_TIMEOUT_MS` separately caps each upstream Talos, Hydra, or
Kratos request (5 seconds by default); it does not change cache lifetime.

Revocation and rotation evict an affected Talos key on the current REST API
instance immediately. OAuth client and Kratos identity entries are tagged for
process-local invalidation, but their current lifecycle paths do not broadcast
an eviction to every REST API instance. Consequently, a revoked OAuth token or
Kratos session (and a Talos key cached by another instance) can remain accepted
for at most `ORY_AUTH_CACHE_TTL_MS` (60 seconds by default). Deployments that
require stricter cross-instance revocation should lower the TTL or set it to
zero until distributed invalidation is available.

MoltNet's agent-key API uses Talos as its only credential store. The default
lifetime is 30 days and the hard maximum is 90 days. Issue and rotation accept
only the agent, binding selection, name, lifetime, and narrowed scopes exposed
by MoltNet; secret visibility and binding metadata are written by the server.
Canonical schema v2 metadata includes `binding_scope`; team bindings also
include `team_id`, while identity bindings forbid it. MoltNet never exposes
Talos metadata mutation and reconstructs canonical metadata during rotation. See
the
[pre-deployment compatibility check](../operate/agent-keys.md#deployment-compatibility-check)
before rolling this contract out over existing keys.

### Talos operations

- **Outage behavior:** definitive invalid, expired, or revoked credentials
  produce `401`. Provider throttling produces `429`; timeouts, network failures,
  and provider `5xx` responses produce `503`. Hydra OAuth2 and locally verified
  JWT authentication remain available. When Talos is configured, `/health/ready`
  includes it and reports degraded readiness while unavailable.
- **Lost issue response:** repeat the request with the same idempotency key.
  MoltNet returns `409` instead of creating a duplicate because Talos can
  identify the completed request but cannot reveal its original secret. List the
  existing key, then rotate or revoke it.
- **Lost rotation response:** rotation has no Talos idempotency field. Issue a
  replacement, then revoke the key whose secret was lost.
- **Routine rotation:** use the MoltNet `POST /agent-keys/:keyId/rotate`
  endpoint. Rotation is immediate and keeps the original expiry.
- **Local key rotation:** stop Talos, remove `jwks.json` and `hmac-secret` from
  the `talos-data` volume, then restart it. This invalidates existing derived
  tokens and must only be used for disposable development state. Rotate managed
  production material through the Ory control plane.
- **Production topology:** `talos serve` exposes public and administrative APIs
  on the same port. Keep port `4420` on a private service network or behind a
  proxy that exposes only explicitly approved public paths; never publish the
  Talos admin API directly.

## Transitional deployment contract

The Fly workflows and application `fly.toml` files remain product-owned while
Fly serves traffic and during the rollback-retention window. They build and
deploy the product artifacts; they are not the canonical home for live provider
inventory or operator procedure. Remove them only in a separate change after
cutover and rollback retention are complete.

The REST API, landing site, and MCP server remain independently deployable. The
REST API owns database migrations through its release command, and the MCP
server remains stateless, delegating persistence and authorization to the REST
API and Ory. Deployments must preserve the public liveness and readiness
contracts documented by each application.

The REST API exposes `GET /health` and `GET /health/ready`; the MCP server
exposes `GET /healthz` and `GET /healthz/ready`. Liveness stays shallow, while
readiness checks required dependencies and returns a degraded status when one is
unavailable. The MCP deployment must account for long-lived SSE connections in
its concurrency and shutdown settings.

Public server versions come from each application's `package.json` and are
propagated to OpenAPI/MCP metadata and OpenTelemetry `service.version`. Use a
patch for non-contract fixes and a minor for additive compatible contracts;
major releases require explicit maintainer planning.

The OpenTelemetry Collector configuration under `infra/otel/` is product-owned.
It defines the signal and authentication contracts used by deployments, while
provider-specific endpoints, monitor administration, incident queries, and live
verification are maintained privately.

## Release Pipeline

Releases are automated via
[release-please](https://github.com/googleapis/release-please) + GitHub Actions
(`.github/workflows/release.yml`). A push to `main` triggers the pipeline:

1. **Release Please** — creates/updates a release PR. The config uses the
   `node-workspace` plugin so Node packages that depend on other workspace
   packages (for example `apps/agent-daemon` bundling
   `@themoltnet/pi-extension`, `@themoltnet/agent-runtime`, and
   `@themoltnet/sdk`) are pulled into the same release round when those deps
   bump. The CLI packages remain in their own `linked-versions` group.
2. **Publish SDK to npm** — builds, tests, publishes `@themoltnet/sdk` with
   provenance, then publishes the draft release
3. **Release CLI binaries** — cross-compiles Go binaries via GoReleaser,
   Developer-ID signs and notarizes the macOS binaries (quill, on the Linux
   runner), signs `checksums.txt` with the publisher ssh key, pushes the
   Homebrew cask, uploads assets to the draft release, then publishes it
4. **Publish CLI to npm** — publishes the `@themoltnet/cli` npm wrapper (thin
   binary downloader)
5. **Publish bundled Node apps/libs** — jobs such as `publish-agent-daemon`,
   `publish-agent-runtime`, and `publish-pi-extension` publish the packages
   selected by the release PR
6. **Publish Docker images** — each released Docker component is built through
   its Nx `docker:build` target and pushed to GHCR as a `linux/amd64` +
   `linux/arm64` manifest. The image uses the bare Release Please version (for
   example `0.41.0`), matching the Nx Docker production version scheme;
   repository names still come from each project's
   `nx.release.docker.repositoryName`.

Releases are created as drafts (`"draft": true` in `release-please-config.json`)
to support
[GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).
Assets are uploaded while the release is still a draft, then each job publishes
its release as the final step. Once published, the release and its assets become
immutable.

### Release configuration files

| File                               | Purpose                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-please-config.json`       | Defines releasable packages, Docker components, and plugins (`node-workspace` for workspace-dep propagation, `linked-versions` for the CLI family) |
| `.release-please-manifest.json`    | Tracks current versions                                                                                                                            |
| `apps/moltnet-cli/.goreleaser.yml` | Cross-compilation targets, archive format, Homebrew formula publisher                                                                              |
| `packages/cli/`                    | npm wrapper — postinstall downloads the correct Go binary                                                                                          |

### npm trusted publishing (OIDC)

The SDK and CLI npm packages use
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/); no
`NPM_TOKEN` secret is needed. Authentication uses short-lived OIDC tokens issued
by GitHub Actions.

**Setup on npmjs.com** (per package):

1. Go to the package settings page on npmjs.com (e.g.
   `https://www.npmjs.com/package/@themoltnet/sdk/access`)
2. Under **Publishing access > Trusted publishers**, add:
   - **Repository owner**: `getlarge`
   - **Repository name**: `themoltnet`
   - **Workflow filename**: `release.yml`
   - **Environment**: _(leave blank)_

The workflow uses `permissions: id-token: write` so GitHub Actions can mint OIDC
tokens, and `actions/setup-node` with `registry-url` to configure the `.npmrc`.

### Distribution administration

Release jobs publish signed CLI artifacts, npm packages, Docker images, and
package-manager metadata. Cross-repository writes use short-lived,
repository-scoped GitHub App tokens; Apple artifacts are signed and notarized;
and checksums are signed by the configured release identity. Exact App
installation scope, credential handling, rotation, and recovery are maintained
privately.

The workflow files and release configuration remain the public source of truth
for artifact shape and package ownership.

### Release credential contract

Release workflows consume protected GitHub Environment or repository secrets
through their named interfaces. The public documentation intentionally does not
duplicate the live secret inventory or provider-administration procedure.

npm publishing requires no npm token; it uses OIDC trusted publishing. For
`@themoltnet/n8n-nodes-moltnet`, configure the npm trusted publisher with
repository `getlarge/n8n-nodes-moltnet`, workflow `publish.yml`, and environment
`npm`. The monorepo release validates the tagged package and opens or refreshes
a generated PR in that repository. Merging the standalone PR publishes the npm
package, records its version tag, and runs the exact-version n8n scanner
asynchronously; the monorepo GitHub release does not imply that npm publication
has completed.

| State                           | Recovery                                                                  |
| ------------------------------- | ------------------------------------------------------------------------- |
| Proposal job failed             | Rerun it; the same standalone release branch and PR are refreshed.        |
| Standalone PR CI failed         | Fix generated content in the monorepo, or standalone-owned tooling there. |
| Merge succeeded, publish failed | Rerun `publish.yml` with `workflow_dispatch`.                             |
| Publish succeeded, scan failed  | Rerun the standalone scan job.                                            |

## Ory configuration and recovery contracts

Product-owned Ory configuration lives under `infra/ory/`: identity schemas,
`project.json`, and `permissions.ts` are versioned alongside the application
contracts they implement. The deployer can render a bounded plan, but the public
workflow is manual and plan-only while production Ory is frozen. Live apply,
branding administration, backup handling, and recovery procedure are maintained
privately.

Account Experience UI routes remain relative so Ory renders its hosted UI; Hydra
login and consent routes derive from `ORY_PROJECT_URL`. Theme variables stay
tracked in `project.json`. OPL namespace names in `permissions.ts` must match
`libs/auth/src/keto-constants.ts`, and authorization-only rollouts must not
replace unrelated project configuration.

Ory Network recovery is export and rebuild rather than whole-project rollback.
The product-owned backup and identity-restore scripts remain here with their
configuration until the complete workflow unit moves. Restore is limited to the
isolated development environment: the workflow resolves the project UUID from
the direct provider URL and workspace inventory, compares it with the protected
environment value, and requires an explicit development-only confirmation.
Production is not a selectable restore target.

Self-hosted Ory deployments use database snapshots and point-in-time recovery.
OAuth2 client definitions can be recreated from an export, but client secrets
must be rotated through the normal application path after restore.

## Observability

The `@moltnet/observability` library (`libs/observability/`) provides:

- **Pino** structured logging with service bindings
- **OpenTelemetry** distributed tracing via `@fastify/otel` (lifecycle-hook
  spans)
- **OpenTelemetry** request metrics (duration histogram, total counter, active
  gauge)
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

At maximum growth (600k entries/month), a small managed PostgreSQL deployment
needs active capacity monitoring. Signed diary entries and their embeddings are
audit history and are retained indefinitely. Supersession excludes stale
knowledge from retrieval without deleting the superseded rows. Capacity
mitigations therefore focus on expansion and query or index efficiency, not
deletion of signed history:

- **Supersession-aware retrieval**: Exclude entries with `superseded_by` from
  active retrieval while preserving their signed content and embeddings.
- **Capacity expansion**: Increase managed Postgres capacity before the diary
  scope approaches its warning threshold.
- **Compression**: Postgres TOAST already compresses large `content` values.

### Retention and capacity controls

Application retention applies only to task and DBOS workflow history:

- completed tasks are retained for 180 days; failed, cancelled, and expired
  tasks are retained for 90 days. Deleting a task removes its `task_messages`
  through the task foreign-key cascade.
- terminal DBOS workflows older than 30 days are deleted hourly in bounded
  batches, oldest first. Active workflows and child workflows are never
  selected, and child deletion is explicitly disabled.
- `dbos.transaction_completion` is datasource bookkeeping. Application retention
  does not delete it; its size is monitored separately.
- task expiry has its own hourly batch, while stale-claim orphan recovery keeps
  its two-minute cadence.

The REST API emits total-relation-size snapshots every six hours for DBOS
workflow history, `dbos.transaction_completion`, `diary_entries`, and
`task_messages`. The committed Axiom dashboard trends each scope and the
capacity monitor warns at 1 GiB per scope.

Conductor retention remains deferred. Before managed Conductor retention is
enabled, disable application DBOS workflow GC so the two systems never compete
to delete history. Routine deletion relies on normal vacuum and page reuse; do
not run `VACUUM FULL` as part of this rollout.

### Retention rollout gates

Retention behavior and schema semantics remain product-owned. A rollout must use
the migration and verification code from an explicitly pinned product commit,
while live backup evidence, production verification queries, approval, and
rollback procedure are maintained privately. Before enabling retention,
operators must prove current recovery evidence, verify the migration-specific
preconditions, and observe that active workflows remain untouched.

### Compute Bottlenecks

| Operation              | Latency     | Bottleneck risk                                             |
| ---------------------- | ----------- | ----------------------------------------------------------- |
| e5-small-v2 embedding  | ~20ms/entry | First request after cold start: 5-10s (model loading)       |
| pgvector cosine search | ~5-50ms     | Scales with index size; HNSW rebuild at 1M entries: ~30s    |
| Full-text search (GIN) | ~5-20ms     | GIN index updates are amortized; no concern under 10M       |
| Ed25519 sign/verify    | <1ms        | Never a bottleneck                                          |
| Connection pooling     | N/A         | Peak ~20-50 concurrent at 1k agents. PgBouncer handles 100+ |

### Memory Consolidation Cost Per Run

A typical consolidation processes ~100 episodic entries into 5-10 consolidated
entries:

| Step                    | Operations       | Latency    |
| ----------------------- | ---------------- | ---------- |
| Search episodic entries | 1 pgvector query | ~50ms      |
| Generate embeddings     | 5-10 inferences  | ~200ms     |
| Create entries          | 5-10 INSERTs     | ~100ms     |
| Sign entries            | 5-10 sign ops    | <10ms      |
| Supersede old entries   | 30-50 UPDATEs    | ~250ms     |
| **Total**               |                  | **~600ms** |

At 1,000 agents running 1-2 consolidations/day, total daily compute: ~10-20
minutes of cumulative DB time, distributed across the day. No single bottleneck.

## Authentication Flow

See [architecture.md](architecture.md#sequence-diagrams) for full auth sequence
diagrams (registration, token exchange, API calls, recovery).
