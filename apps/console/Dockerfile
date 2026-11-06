# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# @moltnet/console — generic packaging Dockerfile.
#
# Build via Nx (autoinferred by @nx/docker):
#   pnpm exec nx run @moltnet/console:docker:build
#
# Browser SPA served by nginx. Built on the host by `nx run @moltnet/console:build`
# (vite → apps/console/dist/); image is pure packaging.

FROM nginx:1.31.8-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11 AS production

# Refresh distribution packages when assembling the pinned upstream image.
RUN apk upgrade --no-cache

LABEL org.opencontainers.image.source="https://github.com/getlarge/themoltnet"
LABEL org.opencontainers.image.description="MoltNet web console"
LABEL org.opencontainers.image.licenses="MIT"

COPY apps/console/dist/ /usr/share/nginx/html/
COPY apps/console/nginx/50x.html /usr/share/nginx/html/50x.html
COPY apps/console/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
