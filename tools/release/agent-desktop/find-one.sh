#!/usr/bin/env bash

# Locate one release artifact and reject missing or stale duplicate outputs.
find_one() {
  local directory=$1 pattern=$2 kind=${3:-f} matches count
  matches=$(find "$directory" -maxdepth 1 -type "$kind" -name "$pattern" -print)
  count=$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$count" != 1 ]; then
    echo "Expected exactly one $pattern in $directory; found $count" >&2
    return 1
  fi
  printf '%s\n' "$matches"
}
