#!/usr/bin/env bash

set -euo pipefail

readonly proxy_app="${FLY_DATABASE_PROXY_APP:-baume-mcp-db}"
readonly local_port="${FLY_DATABASE_PROXY_LOCAL_PORT:-15432}"
readonly remote_port="${FLY_DATABASE_PROXY_REMOTE_PORT:-5432}"

require_environment() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Fly database proxy requires ${name}" >&2
    exit 1
  fi
}

show_proxy_log() {
  local log_path="${FLY_DATABASE_PROXY_LOG:-}"
  if [[ -n "$log_path" && -f "$log_path" ]]; then
    tail -n 100 "$log_path" >&2
  fi
}

start_proxy() {
  require_environment FLY_API_TOKEN
  require_environment SOURCE_DATABASE_URL
  require_environment GITHUB_ENV
  require_environment RUNNER_TEMP

  if nc -z 127.0.0.1 "$local_port" 2>/dev/null; then
    echo "::error::Local proxy port ${local_port} is already in use" >&2
    exit 1
  fi

  local log_path="${RUNNER_TEMP}/fly-database-proxy.log"
  local proxy_pid=''

  cleanup_failed_start() {
    if [[ -n "$proxy_pid" ]] && kill -0 "$proxy_pid" 2>/dev/null; then
      kill "$proxy_pid" 2>/dev/null || true
    fi
  }
  trap cleanup_failed_start ERR

  nohup flyctl proxy "${local_port}:${remote_port}" \
    --app "$proxy_app" \
    --bind-addr 127.0.0.1 \
    --quiet \
    </dev/null >"$log_path" 2>&1 &
  proxy_pid=$!

  local ready='false'
  for _attempt in {1..30}; do
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      echo '::error::Fly database proxy exited before becoming ready' >&2
      FLY_DATABASE_PROXY_LOG="$log_path" show_proxy_log
      return 1
    fi
    if nc -z 127.0.0.1 "$local_port" 2>/dev/null; then
      ready='true'
      break
    fi
    sleep 1
  done

  if [[ "$ready" != 'true' ]]; then
    echo "::error::Fly database proxy did not bind port ${local_port}" >&2
    FLY_DATABASE_PROXY_LOG="$log_path" show_proxy_log
    return 1
  fi

  local local_database_url
  local_database_url="$(
    LOCAL_DATABASE_PROXY_PORT="$local_port" node -e '
      const url = new URL(process.env.SOURCE_DATABASE_URL);
      url.hostname = "127.0.0.1";
      url.port = process.env.LOCAL_DATABASE_PROXY_PORT;
      url.searchParams.set("sslmode", "disable");
      process.stdout.write(url.href);
    '
  )"

  echo "::add-mask::${local_database_url}"
  {
    printf 'FLY_DATABASE_PROXY_PID=%s\n' "$proxy_pid"
    printf 'FLY_DATABASE_PROXY_LOG=%s\n' "$log_path"
    printf 'ABSURD_DATABASE_URL=%s\n' "$local_database_url"
    printf 'MULTI_LENS_REVIEW_DATABASE_URL=%s\n' "$local_database_url"
  } >>"$GITHUB_ENV"

  trap - ERR
}

stop_proxy() {
  local proxy_pid="${FLY_DATABASE_PROXY_PID:-}"
  if [[ -z "$proxy_pid" ]]; then
    return 0
  fi
  if [[ ! "$proxy_pid" =~ ^[0-9]+$ ]]; then
    echo '::warning::Ignoring an invalid Fly database proxy PID' >&2
    return 0
  fi
  if ! kill -0 "$proxy_pid" 2>/dev/null; then
    echo '::warning::Fly database proxy was no longer running at cleanup' >&2
    show_proxy_log
    return 0
  fi

  local process_name
  process_name="$(ps -p "$proxy_pid" -o comm= 2>/dev/null | tr -d '[:space:]')"
  if [[ "$process_name" != 'flyctl' && "$process_name" != 'fly' ]]; then
    echo "::warning::Refusing to stop unexpected PID ${proxy_pid} (${process_name:-unknown})" >&2
    return 0
  fi

  kill "$proxy_pid" 2>/dev/null || true
  for _attempt in {1..10}; do
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  kill -KILL "$proxy_pid" 2>/dev/null || true
}

case "${1:-}" in
  start)
    start_proxy
    ;;
  stop)
    stop_proxy
    ;;
  *)
    echo 'Usage: fly-database-proxy.sh <start|stop>' >&2
    exit 2
    ;;
esac
