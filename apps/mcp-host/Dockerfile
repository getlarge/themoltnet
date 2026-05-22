FROM node:22.19.0-slim AS base
RUN npm install -g pnpm@10.29.3
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/mcp-host/package.json apps/mcp-host/
COPY apps/mcp-host-e2e/package.json apps/mcp-host-e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm exec nx run @moltnet/mcp-host:build

FROM node:22.19.0-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/apps/mcp-host ./dist
COPY --from=build /app/apps/mcp-host/server.mjs ./server.mjs
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
