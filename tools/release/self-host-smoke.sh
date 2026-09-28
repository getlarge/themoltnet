#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 3 ] && [ "$1" = '--cleanup' ]; then
  cleanup_only=true
  bundle_argument="$2"
  project_name="$3"
  if [[ ! "$project_name" =~ ^self-host-smoke-[0-9a-f]{16}$ ]]; then
    echo 'Expected a self-host-smoke-<16 hex characters> project name' >&2
    exit 2
  fi
elif [ "$#" -eq 1 ]; then
  cleanup_only=false
  bundle_argument="$1"
  project_name="self-host-smoke-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
else
  echo 'Usage: self-host-smoke.sh <bundle-root>' >&2
  echo '       self-host-smoke.sh --cleanup <bundle-root> <project-name>' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle_root="$(cd "$bundle_argument" && pwd)"

if [ "$cleanup_only" = false ]; then
  echo "Self-host smoke Compose project: $project_name"
  projects="$(docker compose ls --all --filter name=self-host-smoke --quiet)"
  stale_projects="$(printf '%s\n' "$projects" | grep '^self-host-smoke-' || true)"
  if [ -n "$stale_projects" ]; then
    echo 'Existing self-host smoke projects may hold the fixed host ports:' >&2
    while IFS= read -r stale; do
      printf '  %s\n' "$stale" >&2
      printf '  Recovery (runs Compose down -v): %q --cleanup %q %q\n' \
        "$repo_root/tools/release/self-host-smoke.sh" "$bundle_root" "$stale" >&2
    done <<< "$stale_projects"
    exit 1
  fi
fi

temporary="$(mktemp -d)"
stack_started=false
cleanup() {
  status=$?
  trap - EXIT INT TERM
  echo "Cleaning up self-host smoke project: $project_name" >&2
  keep_temporary=false
  if [ "$stack_started" = true ]; then
    if [ "$status" -ne 0 ]; then
      "${compose[@]}" ps --all || true
      "${compose[@]}" logs --no-color --tail=80 || true
    fi
    if ! "${compose[@]}" down -v; then
      echo "Compose cleanup failed for project $project_name" >&2
      status=1
      keep_temporary=true
    fi
  fi
  if [ "$keep_temporary" = true ]; then
    echo "Recovery environment retained at $temporary" >&2
  else
    rm -rf "$temporary"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node "$repo_root/tools/release/self-host-smoke-prepare.mjs" "$bundle_root" "$temporary"

cd "$bundle_root/deploy/self-host"
export MOLTNET_SMOKE_CADDYFILE="$temporary/Caddyfile.smoke"
compose=(docker compose -p "$project_name" --env-file "$temporary/self-host-smoke.env" --env-file .env.release -f compose.yaml -f "$repo_root/tools/release/self-host-smoke.compose.yaml")

if [ "$cleanup_only" = true ]; then
  echo "Removing self-host smoke Compose project: $project_name"
  "${compose[@]}" down -v
  exit 0
fi

printf 'Interrupted-run recovery (Compose down -v): (cd %q && MOLTNET_SMOKE_CADDYFILE=%q ' \
  "$PWD" "$MOLTNET_SMOKE_CADDYFILE"
printf '%q ' "${compose[@]}" down -v
printf ')\n'

stack_started=true
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
