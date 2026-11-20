#!/usr/bin/env bash
# Ordered Ory maintenance for the standalone bundle. Run from deploy/self-host.
#   ./maintain.sh init    [docker compose options]  new installation only
#   ./maintain.sh upgrade [docker compose options]  existing installation
# Options default to `--env-file .env`. Every step must succeed before the next
# one runs; init stops at talos-init when the Talos volume already holds state.
set -euo pipefail

case "${1:-}" in
  init | upgrade)
    mode=$1
    shift
    ;;
  *)
    echo 'Usage: maintain.sh init|upgrade [docker compose options...]' >&2
    exit 2
    ;;
esac
[ "$#" -gt 0 ] || set -- --env-file .env
compose_options=("$@")
wait_timeout=${MOLTNET_WAIT_TIMEOUT:-300}

compose() {
  echo "==> docker compose $*" >&2
  docker compose "${compose_options[@]}" "$@"
}

compose config --quiet
if [ "$mode" = init ]; then
  compose up -d --wait --wait-timeout "$wait_timeout" postgres
  compose run --rm --no-deps ory-db-init
  compose run --rm --no-deps talos-init
else
  compose --profile maintenance pull
  # PostgreSQL keeps running; nothing may use the Ory schemas while they migrate.
  compose stop caddy console mcp-server rest-api kratos-ui kratos hydra keto talos
fi
for job in kratos-migrate hydra-migrate keto-migrate talos-migrate; do
  compose run --rm --no-deps "$job"
done
compose up -d --wait --wait-timeout "$wait_timeout"
compose run --rm --no-deps hydra-native-client
compose ps --all
