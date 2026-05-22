FROM node:22.19.0-slim AS base
RUN npm install -g pnpm@10.29.3
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/mcp-host/package.json apps/mcp-host/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @moltnet/mcp-host exec vite build

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
