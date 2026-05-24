# syntax=docker/dockerfile:1.7
# @moltnet/landing — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/landing:docker:build
#
# Static landing page served by nginx. Built on the host by
# `nx run @moltnet/landing:build` (vite → apps/landing/dist/).

ARG NGINX_VERSION=1.29

FROM nginx:${NGINX_VERSION}-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet landing page"
LABEL org.opencontainers.image.licenses="MIT"

COPY apps/landing/dist/ /usr/share/nginx/html/
COPY apps/landing/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
