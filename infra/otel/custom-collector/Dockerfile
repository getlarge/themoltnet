# syntax=docker/dockerfile:1.7
# Packaging-only image. Nx builds both Linux binaries on the host before
# docker:build; Docker selects the artifact matching BuildKit's TARGETARCH.
FROM alpine:3.21

ARG TARGETARCH

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet authenticated public OpenTelemetry Collector"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 -S otel \
    && adduser -u 10001 -S otel -G otel

COPY infra/otel/custom-collector/_build/linux-${TARGETARCH}/moltnet-otelcol /usr/local/bin/moltnet-otelcol

USER otel:otel
EXPOSE 4317 4318 4319 8888 13133
ENTRYPOINT ["/usr/local/bin/moltnet-otelcol"]
CMD ["--config=/etc/otelcol/config.yaml"]
