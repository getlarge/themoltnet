# syntax=docker/dockerfile:1.7
# @moltnet/rest-api — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/rest-api:docker:build
#
# Architecture (issue #1223):
#   * Host (Nx targets, Nx Cloud cached): build, build:migrate, download-model
#     → produces apps/rest-api/dist/{main.js,migrate.js,openapi.json,models/}
#   * Docker build stage: runs `pnpm install --frozen-lockfile --prod` and
#     `pnpm deploy` inside a linux container so optional native deps
#     (onnxruntime-node, sharp, …) resolve to the right linux binaries.
#   * Production stage: COPYs the deploy tree from build + the host-built
#     dist artifacts. No `nx`, no `vite`, no `tsc` ever runs in here.
#
# This file is intentionally generic — to add a new image, copy it, swap the
# `--filter` arg, the runtime COPYs, the EXPOSE, and the CMD.

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

# Repo is COPYed wholesale; .dockerignore prunes everything not needed for
# `pnpm install` + `pnpm deploy`. Per-app prebuilt dist/ trees come along so
# the deployed tree picks them up via the package's own files glob.
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

RUN pnpm --filter @moltnet/rest-api deploy --legacy --prod /out

# ---------- production ----------
FROM node:${NODE_VERSION}-slim AS production

# Set by buildx automatically (amd64 | arm64). Used to drop foreign-platform
# native binaries from onnxruntime-node, which ships every os/arch combo in
# its npm tarball (~80 MB of unused darwin+win32 binaries otherwise).
ARG TARGETARCH

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet REST API"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    EMBEDDING_CACHE_DIR=/app/models \
    EMBEDDING_ALLOW_REMOTE_MODELS=true
WORKDIR /app

# Runtime tree: app + production node_modules, linux-native.
# `pnpm deploy` copies only the package's `files` glob (dist/, public/) plus
# the trimmed node_modules; dev configs and source are excluded automatically.
COPY --from=build /out ./

# Drizzle migration SQL — consumed by the migrate entrypoint and Fly.io
# release_command. Lives in a sibling workspace, not in rest-api's files glob,
# so we COPY it explicitly from the build stage's repo checkout.
COPY --from=build /repo/libs/database/drizzle/ ./drizzle/

# Strip foreign-platform native binaries from onnxruntime-node's
# pnpm-virtual-store layout. TARGETARCH=amd64 → keep linux/x64;
# TARGETARCH=arm64 → keep linux/arm64. No-op if the path doesn't exist.
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) KEEP_ARCH=x64 ;; \
      arm64) KEEP_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    find node_modules -type d -path '*/onnxruntime-node/bin/napi-v3' | while read -r dir; do \
      find "$dir" -mindepth 1 -maxdepth 1 -type d ! -name linux -exec rm -rf {} +; \
      find "$dir/linux" -mindepth 1 -maxdepth 1 -type d ! -name "${KEEP_ARCH}" -exec rm -rf {} +; \
    done

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
