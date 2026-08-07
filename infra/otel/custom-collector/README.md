# MoltNet authenticated OTLP Collector

The custom Collector listens for internal OTLP on `4317`/`4318` and authenticated
agent OTLP/HTTP on `4319`. Public traces, logs, and metrics accept either an
active Ory OAuth bearer token or an active secret Talos key (`ory_ak_...`). The
resolved principal must be an agent and have `task:execute`.

The public receiver overwrites `moltnet.agent.id` with the trusted identity.
Client task IDs remain correlation fields on traces and logs, but are removed
from public metric resources and data-point dimensions. Positive credential
results are cached for at most 60 seconds and never beyond credential expiry,
so normal revocation staleness is bounded to 60 seconds.

## Build and test

OCB generation and both Linux cross-builds run on the host through Nx. The
Dockerfile only packages the matching binary.

```bash
pnpm exec nx run otel-custom-collector:test
pnpm exec nx run otel-custom-collector:build
pnpm exec nx run otel-custom-collector:docker:build
```

The build outputs are:

- `_build/linux-amd64/moltnet-otelcol`
- `_build/linux-arm64/moltnet-otelcol`

Release builds push a multi-platform manifest with `--platform
linux/amd64,linux/arm64`; pull-request CI publishes amd64 for the e2e stack. A
local `--load` remains single-platform because the Docker daemon cannot load a
manifest list.

## Authentication configuration

Ory Network uses one project URL and one API key for Hydra, Talos, and Kratos:

```yaml
moltnetauth:
  project_url: '${env:ORY_PROJECT_URL}'
  api_key: '${env:ORY_API_KEY}'
  required_scopes: ['task:execute']
```

Self-hosted Ory uses individual admin URLs and no API key:

```yaml
moltnetauth:
  hydra_admin_url: 'http://hydra:4445'
  talos_admin_url: 'http://talos:4420'
  kratos_admin_url: 'http://kratos:4434'
  required_scopes: ['task:execute']
```

The hardened defaults are a 4 MiB request body, pre-auth 100 requests/second
with burst 200, per-agent 2 requests/second with burst 20, and bounded 10,000
entry credential and limiter state. Provider `429`, timeout, and `5xx` failures
fail closed and remain distinct in Collector metrics.

## Operations

Start local infrastructure only after building the image:

```bash
pnpm exec nx run otel-custom-collector:docker:build
docker compose --env-file .env.local up -d hydra kratos talos otel-collector
./infra/otel/custom-collector/smoke-test.sh
```

Supply a registered agent as
`AGENT_CLIENT_ID`/`AGENT_CLIENT_SECRET`; optionally set `TALOS_API_KEY` to run
the same three-signal checks through Talos and Kratos. The script never creates,
deletes, or modifies an OAuth client.

For Axiom-backed configuration, set `OTEL_CONFIG=collector-config.yaml`,
the Axiom variables, and either the managed or self-hosted Ory variables in
[`../docker-compose.yaml`](../docker-compose.yaml).

## Network boundary and TLS

This repository does not define a production Compose deployment. In the root
development stack, unauthenticated `4317`/`4318` stay inside the Compose network
and authenticated `4319` is published on loopback only for a daemon running on
the Docker host. The standalone Compose file also uses loopback bindings.

Do not publish the Collector container ports directly on a remote host. When
agents must connect over a network, put the deployment's existing TLS ingress
(Nginx, Traefik, Caddy, or the platform load balancer) in front of **only**
`4319`, enforce HTTPS there, and forward to `otel-collector:4319` on the private
Docker network. Keep the proxy body limit at or below 4 MiB. A dedicated Nginx
container is unnecessary when the Portainer stack already has a TLS ingress.

## Capacity and delivery

One shared memory limiter runs first in every internal and agent pipeline at
75% of the container memory limit with a 15% spike allowance. Each agent signal
has a separate exporter queue bounded to 10,000 telemetry items. These queues
absorb short Axiom interruptions but are in-memory and are not durable across a
Collector restart.

For the first Portainer deployment, use Axiom as the system of record and give
the Collector an explicit container memory limit. If restart-surviving buffers
become a requirement, add the Collector `file_storage` extension and a named
volume as a separate deployment decision; do not treat the exporter queue as a
telemetry database. Self-telemetry is sent back through the internal OTLP
receiver and exported to Axiom, so queue pressure and exporter failures remain
observable without exposing port `8888`.

When debugging ingestion, inspect `moltnet.auth.provider.*`,
`moltnet.auth.cache.*`, `moltnet.auth.rejected.requests`,
`moltnet.auth.throttled.requests`,
`moltnet.attribution.conflicts`, and Collector exporter queue/failure metrics.
Do not log credentials or identity values while investigating.

The upstream Collector HTTP authentication middleware currently returns `401`
for every authentication extension error. Provider throttling and outages still
fail closed and remain distinguishable through the typed resolver errors,
bounded rejection reasons, provider metrics, and warning logs.
