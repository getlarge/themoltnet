# syntax=docker/dockerfile:1.7
#
# MoltNet custom OpenTelemetry Collector — Ory introspection auth enabled.
#
# Stage 1: install OCB + Go, generate collector source from builder.yaml,
#          compile into a static-ish binary.
# Stage 2: copy the binary into a minimal runtime image.

# --- Stage 1: build -----------------------------------------------------

FROM golang:1.25-alpine AS build

# OCB (builder) version pinned in sync with the components in builder.yaml.
ARG OTELCOL_VERSION=0.150.0

# OCB emits and compiles Go; nothing else is required in the build image.
RUN apk add --no-cache git ca-certificates \
    && go install go.opentelemetry.io/collector/cmd/builder@v${OTELCOL_VERSION}

WORKDIR /src

# Copy the custom extension FIRST so Docker layer cache keys on its
# contents. `builder.yaml`'s `replaces:` + `path:` point at this tree.
COPY oryintrospectionauthextension/ ./oryintrospectionauthextension/

# Builder manifest last — cheapest layer to invalidate.
COPY builder.yaml ./

# Produce the binary. Reproducible build flags:
#   CGO_ENABLED=0  — static binary, no libc coupling
#   GOFLAGS=-trimpath — strip local paths from the binary
RUN CGO_ENABLED=0 GOFLAGS='-trimpath' builder --config=builder.yaml \
    && ls -la _build/moltnet-otelcol

# --- Stage 2: runtime ---------------------------------------------------

FROM alpine:3.21

# Non-root runtime. OTel collector doesn't need root; we mirror the upstream
# image's UID:GID for familiarity.
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 -S otel \
    && adduser -u 10001 -S otel -G otel

COPY --from=build /src/_build/moltnet-otelcol /usr/local/bin/moltnet-otelcol

USER otel:otel

# OCB doesn't set a default config — callers must mount one. Keep this
# consistent with the upstream image so docker-compose swap is painless.
ENTRYPOINT ["/usr/local/bin/moltnet-otelcol"]
CMD ["--config=/etc/otelcol/config.yaml"]
