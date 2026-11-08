#!/usr/bin/env bash
set -euo pipefail

# Called from the pinned runtime checkout. GitHub owns the service lifecycle;
# this helper initializes only that job's disposable database.
case "${ADAPTIVE_EXECUTION_MODE:-durable}" in
  durable)
    : "${ADAPTIVE_DATABASE_URL:?ADAPTIVE_DATABASE_URL is required in durable mode}"
    exit 0
    ;;
  ephemeral) ;;
  *)
    echo 'ADAPTIVE_EXECUTION_MODE must be durable or ephemeral' >&2
    exit 1
    ;;
esac

: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${ADAPTIVE_POSTGRES_CONTAINER:?The job-local Postgres service is required}"
port="${ADAPTIVE_POSTGRES_PORT:-}"
if ! [[ "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
  echo 'The job-local Postgres service has no valid host port' >&2
  exit 1
fi
runtime_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker build --tag adaptive-review-absurd-migrate \
  --file "$runtime_root/infra/absurd/Dockerfile" "$runtime_root/infra/absurd"
# Join only the known service's network namespace. Never initialize the URL
# supplied for durable mode, even if that secret is also present in this job.
docker run --rm --network "container:$ADAPTIVE_POSTGRES_CONTAINER" \
  --env ABSURD_DATABASE_URL=postgresql://issue_lifecycle:issue_lifecycle_secret@127.0.0.1:5432/issue_lifecycle \
  adaptive-review-absurd-migrate uvx absurdctl init --ref 0.4.0
printf 'ADAPTIVE_DATABASE_URL=postgresql://issue_lifecycle:issue_lifecycle_secret@127.0.0.1:%s/issue_lifecycle\n' "$port" >> "$GITHUB_ENV"
