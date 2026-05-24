# syntax=docker/dockerfile:1.7
# @moltnet/mcp-server — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/mcp-server:docker:build
#
# Architecture (issue #1223): host-built dist/ + linux-side pnpm install/deploy.
# See apps/rest-api/Dockerfile for the canonical commentary.

ARG NODE_VERSION=22.19.0
ARG PNPM_VERSION=10.29.3

# ---------- base ----------
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm/bin:$PATH" \
    HUSKY=0 \
    MOLTNET_SKIP_NX_SYNC=1
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}

# ---------- build (pnpm install + pnpm deploy, in linux) ----------
FROM base AS build
WORKDIR /repo

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

RUN pnpm --filter @moltnet/mcp-server deploy --legacy --prod /out

# ---------- production ----------
FROM node:${NODE_VERSION}-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet MCP server"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# Runtime tree: app + production node_modules (includes task-mcp-app's dist
# resolved via workspace symlink, used at runtime via import.meta.url).
COPY --from=build /out ./

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8001/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
