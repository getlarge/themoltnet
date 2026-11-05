# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# @moltnet/database — migration runner.
#
# Build via Nx (autoinferred by @nx/docker; project root is libs/database):
#   pnpm exec nx run @moltnet/database:docker:build
#
# Lightweight image that runs Drizzle migrations then exits. Same shape as
# rest-api/mcp-server: host nx build → linux pnpm install + deploy → package.

ARG PNPM_VERSION=12.14.0

# ---------- base ----------
FROM node:24.22.2-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm/bin:$PATH" \
    HUSKY=0 \
    MOLTNET_SKIP_NX_SYNC=1
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}

# ---------- build (pnpm install + pnpm deploy, in linux) ----------
FROM base AS build
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --prod

COPY . .

RUN pnpm install --offline --frozen-lockfile --prod

RUN pnpm --filter @moltnet/database deploy --legacy --prod /out

# ---------- production ----------
FROM node:24.22.2-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS production

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Runtime entrypoints use Node directly; package managers stay in build stages.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg

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
