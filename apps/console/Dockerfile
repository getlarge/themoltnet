# @moltnet/console — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/console/Dockerfile .

# ---------- base ----------
FROM node:22-slim AS base
RUN npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy workspace package.json files needed for console build
COPY apps/console/package.json apps/console/
COPY libs/design-system/package.json libs/design-system/
COPY libs/api-client/package.json libs/api-client/
COPY libs/models/package.json libs/models/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build

# Copy all source (design-system exports src, needed for Vite build)
COPY . .

RUN pnpm --filter @moltnet/console run build

# ---------- serve ----------
FROM nginx:alpine AS production

COPY --from=build /app/apps/console/dist /usr/share/nginx/html
COPY apps/console/nginx/50x.html /usr/share/nginx/html/50x.html
COPY apps/console/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
