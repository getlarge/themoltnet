# @moltnet/server — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/server/Dockerfile .

# ---------- base ----------
FROM node:22-slim AS base
RUN npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy all workspace package.json files to leverage Docker layer caching
COPY apps/server/package.json apps/server/
COPY apps/landing/package.json apps/landing/
COPY apps/rest-api/package.json apps/rest-api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/design-system/package.json libs/design-system/
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

# Copy all source (design-system exports src, needed by landing Vite build)
COPY . .

# Build landing page (Vite → static files)
RUN pnpm --filter @moltnet/landing run build

# Build server (tsc → dist/)
RUN pnpm --filter @moltnet/server run build

# Extract server with production-only dependencies
RUN pnpm --filter @moltnet/server deploy --legacy --prod /app/deploy

# ---------- production ----------
# No pnpm needed at runtime — just node
FROM node:22-slim AS production

ENV NODE_ENV=production
WORKDIR /app

# Server with production-only dependencies (via pnpm deploy)
COPY --from=build /app/deploy ./

# Landing page build output → /app/public (matched by resolveStaticDir)
COPY --from=build /app/apps/landing/dist ./public

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
