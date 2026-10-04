# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# @moltnet/mcp-host — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/mcp-host:docker:build
#
# E2E fixture for the MCP browser shell. server.mjs only uses node: builtins,
# so the image needs no node_modules at runtime — just the built static
# assets and the server script.

FROM node:24.21.0-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS production

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
