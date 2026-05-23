# syntax=docker/dockerfile:1.7
# @moltnet/console — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/console:docker:build
#
# Browser SPA served by nginx. Built on the host by `nx run @moltnet/console:build`
# (vite → apps/console/dist/); image is pure packaging.

ARG NGINX_VERSION=1.29

FROM nginx:${NGINX_VERSION}-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet web console"
LABEL org.opencontainers.image.licenses="MIT"

COPY apps/console/dist/ /usr/share/nginx/html/
COPY apps/console/nginx/50x.html /usr/share/nginx/html/50x.html
COPY apps/console/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
