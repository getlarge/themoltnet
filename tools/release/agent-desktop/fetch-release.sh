#!/usr/bin/env bash
# Fetch one release, including drafts, because releases/tags only returns published releases.
set -euo pipefail

output=${1:?usage: fetch-release.sh <output-json>}
pages=$(mktemp "${RUNNER_TEMP:-/tmp}/agent-desktop-releases.XXXXXX")
trap 'rm -f "$pages"' EXIT

gh api --paginate "repos/${GITHUB_REPOSITORY}/releases?per_page=100" > "$pages"
jq -s --arg tag "$RELEASE_TAG" '
  [.[][] | select(.tag_name == $tag)]
  | if length == 1 and .[0].draft == true then .[0]
    elif length == 1 then error("desktop release " + $tag + " is no longer a draft")
    elif length == 0 then error("desktop draft " + $tag + " was not found")
    else error("multiple desktop releases found for " + $tag)
    end
' "$pages" > "$output"
