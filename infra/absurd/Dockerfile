# syntax=docker/dockerfile:1.7

FROM ghcr.io/astral-sh/uv:0.9.27-python3.12-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

ENV UV_LINK_MODE=copy
