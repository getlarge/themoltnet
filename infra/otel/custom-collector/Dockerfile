# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# Packaging-only image. Nx builds both Linux binaries on the host before
# docker:build; Docker selects the artifact matching BuildKit's TARGETARCH.
FROM alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab

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
