ARG TARGETARCH

FROM node:22.19.0-slim AS base
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://go.dev/dl/go1.25.0.linux-${TARGETARCH}.tar.gz" -o /tmp/go.tgz && \
    rm -rf /usr/local/go && \
    tar -C /usr/local -xzf /tmp/go.tgz && \
    rm /tmp/go.tgz
ENV PATH="/usr/local/go/bin:${PATH}"
RUN npm install -g pnpm@10.29.3
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/mcp-host/package.json apps/mcp-host/
COPY apps/mcp-host-e2e/package.json apps/mcp-host-e2e/
COPY libs/design-system/package.json libs/design-system/
COPY libs/task-mcp-app/package.json libs/task-mcp-app/
COPY libs/entry-explore-mcp-app/package.json libs/entry-explore-mcp-app/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm exec nx run @moltnet/mcp-host:build

FROM node:22.19.0-slim AS production
LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet MCP host e2e fixture"
LABEL org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/apps/mcp-host ./dist
COPY --from=build /app/apps/mcp-host/server.mjs ./server.mjs
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
