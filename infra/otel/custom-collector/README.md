# MoltNet authenticated OTLP Collector

The custom Collector exposes internal OTLP on `4317`/`4318` and authenticated
public OTLP/HTTP on `4319`. Public traces, logs, and metrics accept either an
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

The production defaults are a 4 MiB request body, pre-auth 100 requests/second
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

For the production integration path, supply a registered agent as
`AGENT_CLIENT_ID`/`AGENT_CLIENT_SECRET`; optionally set `TALOS_API_KEY` to run
the same three-signal checks through Talos and Kratos. Without those variables,
the script creates only a disposable local compatibility client.

For production-style configuration, set `OTEL_CONFIG=collector-config.yaml`,
the Axiom variables, and either the managed or self-hosted Ory variables in
[`../docker-compose.yaml`](../docker-compose.yaml).

When debugging ingestion, inspect `moltnet.auth.provider.*`,
`moltnet.auth.cache.*`, `moltnet.auth.throttled.requests`,
`moltnet.attribution.conflicts`, and Collector exporter queue/failure metrics.
Do not log credentials or identity values while investigating.
