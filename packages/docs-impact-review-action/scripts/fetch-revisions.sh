#!/usr/bin/env bash
# Fetches commits as inert git data: never checked out or executed.
#
#   fetch-revisions.sh [--depth N] <oid>...
#
# GH_TOKEN authenticates this one fetch, so private repositories work, but it
# is never written to .git/config: nothing later can reuse it. The header
# travels through git's environment rather than its command line, and its
# base64 form is masked (GitHub masks only the raw token).
set -euo pipefail

depth=()
if [ "${1:-}" = --depth ]; then
  depth=(--depth="$2")
  shift 2
fi
if [ "$#" -eq 0 ]; then
  echo "::error::fetch-revisions.sh needs at least one revision" >&2
  exit 2
fi
for oid in "$@"; do
  if ! [[ "$oid" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::not a full commit id: $oid" >&2
    exit 2
  fi
done

auth="$(printf 'x-access-token:%s' "${GH_TOKEN:?GH_TOKEN is required}" | base64 | tr -d '\n')"
echo "::add-mask::$auth"
GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="http.${GITHUB_SERVER_URL:-https://github.com}/.extraheader" \
  GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" \
  git fetch --no-tags "${depth[@]}" origin "$@"
