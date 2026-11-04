# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# @moltnet/mcp-host — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/mcp-host:docker:build
#
# E2E fixture for the MCP browser shell. server.mjs only uses node: builtins,
# so the image needs no node_modules at runtime — just the built static
# assets and the server script.

FROM node:24.22.2-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS production

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Runtime entrypoints use Node directly; package managers stay in build stages.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet MCP host e2e fixture"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# Host-built static bundle (nx run @moltnet/mcp-host:build → apps/mcp-host/dist).
COPY apps/mcp-host/dist/ ./dist/
COPY apps/mcp-host/server.mjs ./server.mjs

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
