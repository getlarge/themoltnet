#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ] || { [ "$2" != candidate ] && [ "$2" != published ]; }; then
  echo 'Usage: self-host-smoke.sh <bundle-root> <candidate|published>' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle_root="$(cd "$1" && pwd)"
mode="$2"
temporary="$(mktemp -d)"
node "$repo_root/tools/release/self-host-smoke-prepare.mjs" "$bundle_root" "$temporary" "$mode"

cd "$bundle_root/deploy/self-host"
compose=(docker compose -p self-host-smoke --env-file "$temporary/self-host-smoke.env" --env-file .env.release)
if [ "$mode" = candidate ]; then
  compose+=(--env-file "$temporary/self-host-candidate.env")
fi
compose+=(-f compose.yaml -f "$repo_root/tools/release/self-host-smoke.compose.yaml")

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
"${compose[@]}" exec -T postgres sh -ec '
  PGPASSWORD="$KETO_DB_PASSWORD" psql -h localhost -U keto -d keto -Atqc "select 1" | grep -qx 1
  if PGPASSWORD="$KETO_DB_PASSWORD" psql -h localhost -U keto -d kratos -Atqc "select 1" >/dev/null 2>&1; then
    echo "A service role reached another service database" >&2
    exit 1
  fi
'
(cd "$repo_root" && pnpm exec tsx tools/release/self-host-smoke.mjs "$temporary/self-host-smoke.env")
