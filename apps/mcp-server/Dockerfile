# @moltnet/mcp-server — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/mcp-server/Dockerfile .

# ---------- base ----------
FROM node:22.19.0-slim AS base
RUN npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy only the workspace package.json files needed by the direct build path
COPY apps/mcp-server/package.json apps/mcp-server/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/design-system/package.json libs/design-system/
COPY libs/models/package.json libs/models/
COPY libs/task-mcp-app/package.json libs/task-mcp-app/
COPY libs/mcp-test-harness/package.json libs/mcp-test-harness/
COPY libs/auth/package.json libs/auth/
COPY libs/diary-service/package.json libs/diary-service/
COPY libs/api-client/package.json libs/api-client/
COPY libs/bootstrap/package.json libs/bootstrap/
COPY libs/mcp-auth-proxy/package.json libs/mcp-auth-proxy/
COPY libs/tasks/package.json libs/tasks/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build

COPY . .

# Build the bundled task UI artifact first so pnpm deploy packages it for runtime.
RUN pnpm --filter @moltnet/task-mcp-app exec vite build && \
    pnpm --filter @moltnet/mcp-server exec vite build

# Extract mcp-server with production-only dependencies.
# Keep scripts off in deploy trees so root postinstall does not run `nx sync`
# against the partial /app/deploy workspace. The long-term fix is tracked in
# #1223, where images should package prebuilt outputs and stop relying on
# pnpm deploy for this path.
RUN pnpm --filter @moltnet/mcp-server deploy --legacy --prod --ignore-scripts /app/deploy

# ---------- production ----------
# No pnpm needed at runtime — just node
FROM node:22.19.0-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet MCP server"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# MCP server with production-only dependencies (via pnpm deploy)
COPY --from=build /app/deploy ./

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8001/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
