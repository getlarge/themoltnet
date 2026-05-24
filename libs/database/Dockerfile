# syntax=docker/dockerfile:1.7
# @moltnet/database — migration runner.
#
# Build via Nx (autoinferred by @nx/docker; project root is libs/database):
#   pnpm exec nx run @moltnet/database:docker:build
#
# Lightweight image that runs Drizzle migrations then exits. Same shape as
# rest-api/mcp-server: host nx build → linux pnpm install + deploy → package.

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

RUN pnpm --filter @moltnet/database deploy --legacy --prod /out

# ---------- production ----------
FROM node:${NODE_VERSION}-slim AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet database migration runner"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd -r migrate && useradd -r -g migrate migrate

# Runtime tree: tsc dist + drizzle migration SQL (both in @moltnet/database's
# files glob, so pnpm deploy ships them automatically).
COPY --from=build --chown=migrate:migrate /out ./

USER migrate

CMD ["node", "dist/src/migrate-cli.js"]
