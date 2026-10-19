#!/usr/bin/env bash
set -euo pipefail

for revision in BASE_SHA HEAD_SHA; do
  if ! [[ "${!revision:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::$revision must be a full commit id" >&2
    exit 2
  fi
done

auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
echo "::add-mask::$auth"

authenticated_fetch() {
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.${GITHUB_SERVER_URL:-https://github.com}/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" \
    git fetch --no-tags "$@"
}

authenticated_fetch --depth=1 origin "$HEAD_SHA"

# Three-dot review diffs need the merge base, while the pinned trees need
# complete blobs. Deepen only as far as this PR's ancestry requires.
deepen=32
until git merge-base "$BASE_SHA" "$HEAD_SHA" >/dev/null 2>&1; do
  if [[ "$(git rev-parse --is-shallow-repository)" != 'true' ]]; then
    echo '::error::review revisions have no common ancestor' >&2
    exit 1
  fi
  authenticated_fetch "--deepen=$deepen" origin "$BASE_SHA" "$HEAD_SHA"
  deepen=$((deepen * 2))
done
