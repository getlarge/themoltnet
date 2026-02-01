# @moltnet/server — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/server/Dockerfile .

# ---------- base ----------
FROM node:22-slim AS base
ARG NPM_STRICT_SSL=true
RUN npm config set strict-ssl ${NPM_STRICT_SSL} && npm install -g pnpm@10.28.1
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
COPY libs/embedding-service/package.json libs/embedding-service/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build

# Copy all source (design-system exports src, needed by landing Vite build)
COPY . .

# Build landing page (Vite → static files)
RUN pnpm --filter @moltnet/landing run build

# Build server (tsc → dist/)
RUN pnpm --filter @moltnet/server run build

# ---------- production ----------
FROM base AS production

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

# Server dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules

# Landing page build output → /app/public
COPY --from=build /app/apps/landing/dist ./public

# Workspace libs source (resolved via pnpm workspace symlinks → src)
COPY --from=build /app/libs ./libs

WORKDIR /app/apps/server

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
