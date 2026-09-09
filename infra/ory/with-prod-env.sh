#!/usr/bin/env bash
# Run a maintenance command with production credentials, without ever putting
# them on a command line.
#
# The Ory keys and the production DATABASE_URL live encrypted in
# .env.infra.local. Typing them out to export a connection string puts the
# password in shell history, in `ps` output, and in any transcript of the
# window — for a database whose password is not rotated between windows.
#
# This decrypts them into the child process only, and rewrites DATABASE_URL to
# the local `flyctl mpg proxy` port. Nothing is echoed.
#
# Usage, from the repo root, with the proxy already running:
#   infra/ory/with-prod-env.sh node infra/ory/migrate-keto-subjects.mjs --apply --allow-proxied-database
#   infra/ory/with-prod-env.sh psql "$DATABASE_URL" -c 'select count(*) from agents'
#
# PROXY_PORT overrides the default 15432.
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: with-prod-env.sh <command> [args...]" >&2; exit 64; }

PROXY_PORT="${PROXY_PORT:-15432}"
ENV_FILE="${ENV_FILE:-.env.infra.local}"

# The secrets file is not committed, so in a worktree it exists only in the
# primary checkout. Fall back to that rather than making the operator hunt for
# it mid-window.
if [ ! -f "$ENV_FILE" ]; then
  PRIMARY="$(dirname "$(git rev-parse --git-common-dir 2>/dev/null || echo /nonexistent)")"
  if [ -f "$PRIMARY/$ENV_FILE" ]; then
    echo "using $ENV_FILE from the primary checkout: $PRIMARY" >&2
    ENV_FILE="$PRIMARY/$ENV_FILE"
  else
    echo "FATAL: $ENV_FILE not found here or in $PRIMARY. Set ENV_FILE." >&2
    exit 1
  fi
fi

# Fail before doing anything if the tunnel is not up: every script here would
# otherwise stall on connect partway through a window.
nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null || {
  echo "FATAL: nothing listening on 127.0.0.1:$PROXY_PORT." >&2
  echo "Start it with: flyctl mpg proxy <cluster-id> --local-port $PROXY_PORT" >&2
  exit 1
}

# dotenvx exposes the decrypted values to the child only. The inner node step
# rewrites the host/port to the proxy and re-execs the real command, so the
# password never becomes a shell word in this process.
export MOLTNET_PROXY_PORT="$PROXY_PORT"

exec npx --yes dotenvx run --quiet \
  --env-file "$ENV_FILE" --env-file env.public -- \
  node -e '
    const { spawnSync } = require("node:child_process");
    const raw = process.env.DATABASE_URL;
    if (!raw || raw.startsWith("encrypted:")) {
      console.error("FATAL: DATABASE_URL did not decrypt. Is .env.keys present?");
      process.exit(1);
    }
    const url = new URL(raw);
    url.hostname = "127.0.0.1";
    url.port = process.env.MOLTNET_PROXY_PORT;
    url.searchParams.set("sslmode", "disable");

    const [cmd, ...rest] = process.argv.slice(1);
    const result = spawnSync(cmd, rest, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
    process.exit(result.status ?? 1);
  ' "$@"
