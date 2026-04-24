# MoltNet custom OpenTelemetry Collector

Custom collector build that bundles the `oryintrospectionauth`
extension for gating public OTLP receivers behind Ory Hydra.

## Why

Stock `otel/opentelemetry-collector-contrib` ships `oidcauthextension`,
which only validates JWT signatures locally against JWKS. Ory Network
issues **opaque** access tokens by default, which can't be validated
without a round-trip to the issuer. This build wires in our own
[`oryintrospectionauth`](./oryintrospectionauthextension/) extension
that always introspects.

## Layout

```
custom-collector/
├── builder.yaml                    # OCB manifest — component inventory
├── Dockerfile                      # Two-stage: OCB build → minimal runtime
├── smoke-test.sh                   # End-to-end auth gating test
├── oryintrospectionauthextension/  # The custom extension (Go module)
└── testdata/                       # Fixtures for local/dev tests
```

## Build

Docker (reproducible, what the compose stack uses):

```bash
docker build -t moltnet-otelcol:dev .
```

Local Go (for fast iteration on the extension):

```bash
go install go.opentelemetry.io/collector/cmd/builder@v0.150.0
builder --config=builder.yaml
./_build/moltnet-otelcol --config=testdata/sanity-config.yaml
```

## Local smoke test

The compose stack automatically builds and runs the image. To verify
the auth gate works end-to-end:

```bash
docker compose --env-file .env.local up -d hydra otel-collector
./infra/otel/custom-collector/smoke-test.sh
```

This registers an OAuth2 client, obtains a `telemetry:write`-scoped
access token, and POSTs an OTLP trace to `:4319` — asserting 200 with
a valid token, 401 without.

## Config

See [`oryintrospectionauthextension/README.md`](./oryintrospectionauthextension/README.md)
for the full extension config reference. The dev collector config
[`../collector-config.dev.yaml`](../collector-config.dev.yaml) shows
the typical wiring: authenticated `otlp/public` receiver on `:4319`
alongside the unauthenticated internal-mesh receivers on `:4317`/`:4318`.
