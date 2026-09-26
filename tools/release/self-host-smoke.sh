#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'Usage: self-host-smoke.sh <bundle-root>' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle_root="$(cd "$1" && pwd)"
temporary="$(mktemp -d)"
node "$repo_root/tools/release/self-host-smoke-prepare.mjs" "$bundle_root" "$temporary"

cd "$bundle_root/deploy/self-host"
compose=(docker compose -p self-host-smoke --env-file "$temporary/self-host-smoke.env" --env-file .env.release -f compose.yaml -f "$repo_root/tools/release/self-host-smoke.compose.yaml")

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    "${compose[@]}" ps || true
    "${compose[@]}" logs --tail=80 caddy rest-api mcp-server postgres object-store || true
  fi
  "${compose[@]}" down -v || true
  rm -f "$bundle_root/deploy/self-host/Caddyfile.smoke"
  rm -rf "$temporary"
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d --wait --wait-timeout 300
"${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$temporary/local-ca.crt"
"${compose[@]}" exec -T postgres sh -ec '
  PGPASSWORD="$KETO_DB_PASSWORD" psql -h localhost -U keto -d keto -Atqc "select 1" | grep -qx 1
  if PGPASSWORD="$KETO_DB_PASSWORD" psql -h localhost -U keto -d kratos -Atqc "select 1" >/dev/null 2>&1; then
    echo "A service role reached another service database" >&2
    exit 1
  fi
'
(cd "$repo_root" && pnpm exec tsx tools/release/self-host-smoke.mjs "$temporary/self-host-smoke.env" "$temporary/local-ca.crt")
