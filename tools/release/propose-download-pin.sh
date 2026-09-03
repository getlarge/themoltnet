#!/usr/bin/env bash
# Advance stable download pins only after their release jobs have made the
# artifacts public. The caller opens the resulting reviewable landing PR.
set -euo pipefail

template=${TEMPLATE:-apps/landing/nginx/default.conf.template}
cli_version=${CLI_VERSION:-}
agent_version=${AGENT_VERSION:-}

valid_version() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
advance_pin() {
  local variable=$1 candidate=$2 current
  [ -n "$candidate" ] || return
  valid_version "$candidate" || { echo "invalid $variable version: $candidate" >&2; exit 2; }
  current=$(sed -nE "s/^    set \\\$${variable} ([0-9]+\\.[0-9]+\\.[0-9]+);/\\1/p" "$template")
  [ -n "$current" ] || { echo "missing \$$variable pin in $template" >&2; exit 2; }
  # Do not regress a deliberately ahead pin during a republish.
  [ "$(printf '%s\n%s\n' "$current" "$candidate" | sort -V | tail -1)" = "$candidate" ] || return
  [ "$current" = "$candidate" ] || sed -i.bak "s/^    set \\\$${variable} ${current};/    set \\\$${variable} ${candidate};/" "$template"
  rm -f "$template.bak"
}

advance_pin cli_version "$cli_version"
advance_pin agent_version "$agent_version"
