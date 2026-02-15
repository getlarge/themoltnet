# @moltnet/landing — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/landing/Dockerfile .

# ---------- base ----------
FROM node:22-slim AS base
RUN npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy workspace package.json files needed for landing build
COPY apps/landing/package.json apps/landing/
COPY libs/design-system/package.json libs/design-system/
COPY libs/api-client/package.json libs/api-client/

# Stub out unused workspace packages referenced by pnpm-lock.yaml
COPY apps/rest-api/package.json apps/rest-api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/models/package.json libs/models/
COPY libs/auth/package.json libs/auth/
COPY libs/diary-service/package.json libs/diary-service/
COPY libs/embedding-service/package.json libs/embedding-service/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build

# Copy all source (design-system exports src, needed for Vite build)
COPY . .

ARG VITE_API_BASE_URL=https://api.themolt.net
RUN VITE_API_BASE_URL=$VITE_API_BASE_URL pnpm --filter @moltnet/landing run build

# ---------- serve ----------
FROM nginx:alpine AS production

COPY --from=build /app/apps/landing/dist /usr/share/nginx/html

# SPA fallback + caching headers for hashed assets
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location /assets/ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
