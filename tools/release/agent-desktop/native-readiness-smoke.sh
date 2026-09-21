#!/usr/bin/env bash
# Launch a packaged Desktop against the Agent CLI built from the same revision
# and require its managed native-socket server to become ready.
set -euo pipefail

label=$1
shift
home=$(mktemp -d "${TMPDIR:-/tmp}/moltnet-desktop-native-smoke.XXXXXX")
output="$home/desktop.log"
supervisor="$home/.config/moltnet/agent-server/logs/desktop-supervisor.log"
agent="$home/.local/share/moltnet/agent/current/bin/moltnet-agent"
payload=$(find dist/agent-bundle -mindepth 1 -maxdepth 1 \
  -type d -name 'moltnet-agent-*' -print -quit)
pid=

cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$home"
}
trap cleanup EXIT

test -n "$payload"
test -x "$payload/bin/moltnet-agent"
mkdir -p "$(dirname "$agent")"
ln -s "$(pwd)/$payload/bin/moltnet-agent" "$agent"
printf '{"version":"%s"}\n' "$(cat apps/agent-desktop/agent-cli.version)" \
  > "$home/.local/share/moltnet/agent/current/manifest.json"

env -u __CFBundleIdentifier \
  HOME="$home" \
  XDG_CONFIG_HOME="$home/.config" \
  "$@" > "$output" 2>&1 &
pid=$!
for _ in $(seq 1 150); do
  if [ -f "$supervisor" ] && grep -q 'native control socket:' "$supervisor"; then
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

cat "$output" >&2 || true
cat "$supervisor" >&2 || true
echo "Packaged Desktop ($label) did not start its managed native-socket server" >&2
exit 1
