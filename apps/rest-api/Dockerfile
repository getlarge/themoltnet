# @moltnet/rest-api — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/rest-api/Dockerfile .

# ---------- base ----------
FROM node:22-slim AS base
RUN npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy workspace package.json files (rest-api + transitive deps, NO landing/design-system)
COPY apps/rest-api/package.json apps/rest-api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/models/package.json libs/models/
COPY libs/auth/package.json libs/auth/
COPY libs/diary-service/package.json libs/diary-service/
COPY libs/api-client/package.json libs/api-client/
COPY libs/bootstrap/package.json libs/bootstrap/
COPY libs/embedding-service/package.json libs/embedding-service/
COPY libs/mcp-auth-proxy/package.json libs/mcp-auth-proxy/
COPY tools/package.json tools/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build

COPY . .

RUN pnpm --filter @moltnet/rest-api run build

# Extract rest-api with production-only dependencies
RUN pnpm --filter @moltnet/rest-api deploy --legacy --prod /app/deploy

# ---------- production ----------
FROM node:22-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet REST API"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# REST API with production-only dependencies (via pnpm deploy)
COPY --from=build /app/deploy ./

# OpenAPI spec for static serving
COPY --from=build /app/apps/rest-api/public ./public

# Migration SQL files for Fly.io release_command
COPY --from=build /app/libs/database/drizzle ./drizzle

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
