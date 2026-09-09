#!/usr/bin/env bash
# Progress for a long-running pg_dump/pg_restore that gives no output of its own.
#
# `pg_dump -Fc` writes a single growing file and prints nothing until it
# finishes, which is indistinguishable from a hung proxy. This samples the file
# size and reports the rate, so "slow" and "stalled" stop looking the same.
#
# Usage:
#   tools/dump-progress.sh /tmp/themoltnet-prod-app.dump [interval_seconds]
set -euo pipefail

TARGET="${1:?usage: dump-progress.sh <file> [interval]}"
INTERVAL="${2:-10}"

human() { # bytes -> human readable
  awk -v b="$1" 'BEGIN{
    split("B KB MB GB TB", u, " "); i=1
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    printf "%.1f%s", b, u[i]
  }'
}

size_of() { [ -f "$TARGET" ] && stat -f%z "$TARGET" 2>/dev/null || stat -c%s "$TARGET" 2>/dev/null || echo 0; }

prev="$(size_of)"
start="$prev"
started_at="$(date +%s)"
stalls=0

printf '%-10s %10s %12s %12s   %s\n' TIME SIZE DELTA RATE STATE
while :; do
  sleep "$INTERVAL"
  cur="$(size_of)"
  delta=$(( cur - prev ))
  elapsed=$(( $(date +%s) - started_at ))
  rate=0
  [ "$elapsed" -gt 0 ] && rate=$(( (cur - start) / elapsed ))

  # A dump that stops growing is either finished or wedged. Distinguish them by
  # whether a writer process is still alive, rather than guessing from the size.
  if [ "$delta" -eq 0 ]; then
    stalls=$(( stalls + 1 ))
    if pgrep -f "pg_dump|pg_restore" >/dev/null 2>&1; then
      state="no growth (${stalls}x) — writer alive"
    else
      state="DONE or writer gone"
    fi
  else
    stalls=0
    state="writing"
  fi

  printf '%-10s %10s %12s %10s/s   %s\n' \
    "$(date +%H:%M:%S)" "$(human "$cur")" "+$(human "$delta")" "$(human "$rate")" "$state"

  # Stop once the file has settled and nothing is writing it.
  if [ "$delta" -eq 0 ] && [ "$stalls" -ge 3 ] && ! pgrep -f "pg_dump|pg_restore" >/dev/null 2>&1; then
    echo "final: $(human "$cur") after ${elapsed}s"
    exit 0
  fi
  prev="$cur"
done
