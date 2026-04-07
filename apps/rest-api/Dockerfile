# @moltnet/rest-api — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/rest-api/Dockerfile .

# ---------- base ----------
FROM node:22.19.0-slim AS base
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
COPY libs/context-distill/package.json libs/context-distill/
COPY libs/context-pack-service/package.json libs/context-pack-service/
COPY libs/embedding-service/package.json libs/embedding-service/
COPY libs/mcp-auth-proxy/package.json libs/mcp-auth-proxy/
COPY tools/package.json tools/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Run postinstall for onnxruntime-node (downloads platform-specific native binaries).
# --ignore-scripts skips it during install; rebuild targets only this package.
# Required by the `model` stage below: download-embedding-model.mjs imports
# @huggingface/transformers which dlopens onnxruntime-node at runtime.
RUN pnpm rebuild onnxruntime-node

# ---------- model ----------
# Separate stage so the model download is cached independently of source changes.
# This layer only rebuilds when deps change (lockfile / package.json), not on
# every source commit.
FROM deps AS model
COPY tools/download-embedding-model.mjs tools/
RUN pnpm --filter @moltnet/tools download-model -- --cache-dir /app/models

# ---------- build ----------
FROM deps AS build

COPY . .

RUN pnpm --filter @moltnet/rest-api run build

# Extract rest-api with production-only dependencies
RUN pnpm --filter @moltnet/rest-api deploy --legacy --prod /app/deploy

# Re-run onnxruntime-node postinstall in the deployed tree (pnpm deploy copies
# node_modules but does not re-run install scripts)
RUN pnpm rebuild onnxruntime-node --dir /app/deploy

# Copy pre-downloaded model from the model stage (avoids re-downloading on
# every source change).
COPY --from=model /app/models /app/models

# ---------- production ----------
FROM node:22.19.0-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet REST API"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
# Model is baked in — no remote download needed at runtime
ENV EMBEDDING_CACHE_DIR=/app/models
ENV EMBEDDING_ALLOW_REMOTE_MODELS=false
WORKDIR /app

# REST API with production-only dependencies (via pnpm deploy)
COPY --from=build /app/deploy ./

# Pre-downloaded model files (no huggingface.co access needed at runtime)
COPY --from=build /app/models ./models

# OpenAPI spec for static serving
COPY --from=build /app/apps/rest-api/public ./public

# Migration SQL files for Fly.io release_command
COPY --from=build /app/libs/database/drizzle ./drizzle

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
