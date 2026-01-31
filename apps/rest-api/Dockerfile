# @moltnet/rest-api — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/rest-api/Dockerfile .
#
# NOTE: The app currently exports a factory function but lacks a main.ts
# that starts a server. This Dockerfile targets `node dist/index.js` which
# will work once a main.ts entry point is added.

# ---------- base ----------
FROM node:20-slim AS base
ARG NPM_STRICT_SSL=true
RUN npm config set strict-ssl ${NPM_STRICT_SSL} && npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy all workspace package.json files to leverage Docker layer caching
COPY apps/rest-api/package.json apps/rest-api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/landing/package.json apps/landing/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/design-system/package.json libs/design-system/
COPY libs/models/package.json libs/models/
COPY libs/auth/package.json libs/auth/
COPY libs/diary-service/package.json libs/diary-service/
COPY libs/api-client/package.json libs/api-client/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build

# Copy all source (needed for workspace resolution since exports point to src)
COPY . .

RUN pnpm --filter @moltnet/rest-api run build

# ---------- production ----------
FROM base AS production

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

# App dist + source (exports point to ./src/index.ts for workspace packages)
COPY --from=build /app/apps/rest-api/dist ./apps/rest-api/dist
COPY --from=build /app/apps/rest-api/package.json ./apps/rest-api/

# Workspace libs source (resolved via pnpm workspace symlinks → src)
COPY --from=build /app/libs ./libs

# Workspace node_modules (contains symlinks to workspace packages)
COPY --from=build /app/apps/rest-api/node_modules ./apps/rest-api/node_modules

WORKDIR /app/apps/rest-api

EXPOSE 8000

CMD ["node", "dist/index.js"]
