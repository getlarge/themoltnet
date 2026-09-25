# Self-host with Docker Compose

The release bundle runs the smallest complete MoltNet platform on one Docker
host. It includes the product services and their required identity, database,
cache, object-storage, and ingress dependencies.

## Requirements

- Docker Engine with Compose v2
- a Linux host with persistent storage
- five DNS names resolving to the host
- outbound SMTP for account recovery and verification
- a separate off-host backup destination for PostgreSQL, Talos, and object data

Download a `self-host-vX.Y.Z` archive from GitHub Releases, verify its checksum,
and follow the included `deploy/self-host/README.md`. The release's
`.env.release` pins images built from that release's source revision by digest;
do not replace those pins with floating tags in a production installation.

The Compose bundle does not set up off-host backup or point-in-time recovery.
Arrange both before using it for data you need to keep. The archive includes a
`SHA256SUMS` file; run `sha256sum -c SHA256SUMS` from its root after extraction.

To reproduce the archive from a source checkout without resolving registry
digests, run this command with Docker Compose installed:

```bash
node tools/release/self-host-bundle.mjs --version dev --skip-digests
```

The generated directory uses the component versions in
`.release-please-manifest.json` and the Docker repository names in each
component's `package.json`. Published archives replace those tags with registry
digests.

Hydra's one-shot initialization job applies the tracked `moltnet-native`
authorization-code client before the REST API starts. Its loopback redirect,
scopes, and audiences match the Desktop provisioning flow. Other OAuth clients
can use Hydra dynamic registration; the REST API serves the shared consent page
at `/oauth2/consent`. Keto loads the bundled permission model from
`infra/ory/permissions.ts`. The identity hostname sends browser pages such as
`/login`, `/registration`, and `/recovery` to the Kratos self-service UI;
`/self-service/*` requests go to Kratos itself.

## Collect logs and telemetry

The base bundle keeps bounded Docker logs and leaves `OTLP_ENDPOINT` empty. To
export telemetry, add a deployment-local OpenTelemetry Collector Contrib to the
Compose network and set `OTLP_ENDPOINT=http://otel-collector:4318` for the REST
API and MCP server. Configure its OTLP receiver and an exporter for your
telemetry backend. Attach the Collector to the `services` network and keep its
OTLP ports private. To trace Kratos, Hydra, and Keto too, include the bundled
`compose.tracing.yaml` override when starting or updating the stack:

```bash
docker compose --env-file .env -f compose.yaml -f compose.tracing.yaml up -d
```

The override sends sampled traces to `otel-collector:4318`. Set
`ORY_OTLP_SERVER_URL` to another collector's `host:port` if needed and
`ORY_TRACE_SAMPLING_RATIO` to tune the sampling ratio (default `0.1`). The
pinned Talos OSS image does not emit traces;
[Talos tracing requires its commercial edition](https://github.com/ory/talos/blob/v26.2.0/docs/operate/monitoring/tracing.md).
Its structured logs and metrics endpoint remain available.

Docker stdout is a separate source. The pattern used by MoltNet operations is to
bind the Collector's Fluent Forward receiver to the Docker host's loopback
interface and select Docker's `fluentd` logging driver for infrastructure
services. For example, these are the relevant parts of a Compose override:

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:<pinned-version-or-digest>
    command: [--config=/etc/otelcol/config.yaml]
    networks: [services]
    ports: ['127.0.0.1:24224:24224']
    volumes: ['./config/otel-collector.yaml:/etc/otelcol/config.yaml:ro']

  rest-api:
    environment:
      OTLP_ENDPOINT: http://otel-collector:4318
  mcp-server:
    environment:
      OTLP_ENDPOINT: http://otel-collector:4318

  postgres:
    logging:
      driver: fluentd
      options:
        fluentd-address: 127.0.0.1:24224
        fluentd-async: 'true'
        fluentd-buffer-limit: '1048576'
        tag: 'docker.{{.Name}}'
```

The Collector config needs an `otlp` receiver for app signals and a
`fluent_forward` receiver on `0.0.0.0:24224` for Docker logs, each in its own
pipeline. The receiver portion is:

```yaml
receivers:
  otlp:
    protocols:
      http: { endpoint: '0.0.0.0:4318' }
  fluent_forward:
    endpoint: '0.0.0.0:24224'
```

Route both receivers through processors and an exporter to your chosen backend.
Apply the `postgres` logging stanza to the other infrastructure services whose
stdout you want to export. Keep REST and MCP on the bounded Docker logging
driver when their logs already flow through OTLP; this avoids duplicate
ingestion. Keep the Collector itself on a bounded local logging driver to avoid
a forwarding loop. Docker's `fluentd-async` allows containers to start if the
Collector is temporarily unavailable, but its buffer is not a durable log queue.

MoltNet's
[custom Collector](https://github.com/getlarge/themoltnet/blob/main/infra/otel/custom-collector/README.md)
has a different role: it authenticates and attributes **remote agent** OTLP
traffic. If you expose agent telemetry, run it as a separate gateway, configure
`moltnetauth` with the private Hydra, Talos, and Kratos admin URLs, and expose
only its authenticated HTTP receiver on port `4319` through TLS ingress. Send
its output to the deployment-local Collector. The custom image does not include
the `fluent_forward` receiver, so it cannot collect Docker stdout directly. For
the bundled self-hosted Ory services, its authentication extension uses:

```yaml
extensions:
  moltnetauth:
    hydra_admin_url: http://hydra:4445
    talos_admin_url: http://talos:4420
    kratos_admin_url: http://kratos:4434
    required_scopes: [task:execute]
```

## Upgrade

1. Take and verify a fresh backup.
2. Download and checksum the next self-host release.
3. Compare its `.env.example` and Compose configuration with your overrides.
4. Run `docker compose config --quiet`, pull the digest-pinned images, and let
   the one-shot database and Ory migration services complete.
5. Check service health and the login, OAuth client-credentials, REST, and MCP
   smoke paths before retiring the previous bundle.

Never downgrade a database after its migration has run. Restore the pre-upgrade
backup instead.
