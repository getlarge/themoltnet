# syntax=docker/dockerfile:1.7
# @moltnet/mcp-host — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/mcp-host:docker:build
#
# E2E fixture for the MCP browser shell. server.mjs only uses node: builtins,
# so the image needs no node_modules at runtime — just the built static
# assets and the server script.

ARG NODE_VERSION=22.19.0

FROM node:${NODE_VERSION}-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet MCP host e2e fixture"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# Host-built static bundle (nx run @moltnet/mcp-host:build → dist/apps/mcp-host).
COPY dist/apps/mcp-host/ ./dist/
COPY apps/mcp-host/server.mjs ./server.mjs

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
