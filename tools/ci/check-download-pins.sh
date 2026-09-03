#!/usr/bin/env bash
# Compare the pinned download versions served by the landing nginx template
# against the latest PUBLISHED GitHub releases (drafts excluded).
#
# Advisory by design: stale pins produce a ::warning annotation and (in a PR
# context) one marker-managed PR comment — never a failing job. The pins are
# deliberate; bumping them is the act of publishing.
#
# Run locally (uses your gh auth, prints verdicts, posts nothing):
#   bash tools/ci/check-download-pins.sh
#
# Environment:
#   TEMPLATE            nginx template path (default: the landing template)
#   GITHUB_REPOSITORY   owner/repo           (default: getlarge/themoltnet)
#   PR_NUMBER           when set, post/update the marker comment on that PR
set -euo pipefail

TEMPLATE="${TEMPLATE:-apps/landing/nginx/default.conf.template}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-getlarge/themoltnet}"
PR_NUMBER="${PR_NUMBER:-}"
MARKER='<!-- installer-pin-check -->'

# [$] matches a literal dollar without backslash-escaping games ($$ in a
# double-quoted inline script famously expands to the shell PID).
pin_of() {
  grep -oE "set [\$]$1 [0-9A-Za-z.+-]+;" "$TEMPLATE" | head -1 |
    awk '{print $3}' | tr -d ';'
}

latest_of() {
  # gh release list INCLUDES drafts for repo writers — filter them out, or a
  # stuck draft masquerades as the latest published release.
  gh release list --repo "$GITHUB_REPOSITORY" --limit 100 \
    --json tagName,isDraft \
    --jq "[.[] | select(.isDraft | not) | .tagName | select(startswith(\"$1-v\"))][0] // empty"
}

stale_lines=""

check() {
  local product="$1" var="$2" prefix="$3" version pinned latest newest
  version=$(pin_of "$var")
  if [ -z "$version" ]; then
    echo "::error file=$TEMPLATE::no \$$var pin found in the landing nginx template"
    exit 1
  fi
  pinned="$prefix-v$version"
  latest=$(latest_of "$prefix")
  # Version-ORDER comparison, not equality: a pin pointing at a not-yet-
  # published (draft) release is AHEAD, not behind. Only warn when the
  # latest published release sorts strictly newer than the pin.
  newest=$(printf '%s\n%s\n' "$pinned" "$latest" | sort -V | tail -1)
  if [ -z "$latest" ] || [ "$pinned" = "$latest" ] || [ "$newest" = "$pinned" ]; then
    echo "$product pin $pinned is current or ahead (latest published: ${latest:-none})"
    return 0
  fi
  echo "::warning file=$TEMPLATE::themolt.net serves $product $pinned but the latest release is $latest — bump the pin when that version should become public"
  stale_lines="$stale_lines
- **$product**: pinned \`$pinned\`, latest published \`$latest\`"
}

check "MoltNet CLI" cli_version cli
check "MoltNet agent bundle" agent_version agent-daemon

[ -n "$stale_lines" ] || exit 0
[ -n "$PR_NUMBER" ] || {
  echo "(no PR_NUMBER — skipping the PR comment)"
  exit 0
}

body=$(printf '%s\n%s\n%s\n\n%s' \
  "$MARKER" \
  "⚠️ **Download pins are behind** — themolt.net serves older versions than the latest published releases:" \
  "$stale_lines" \
  "The pins are deliberate — bump the \`set\` lines in \`$TEMPLATE\` when those versions should become public. [**Open a pin-update PR**](https://github.com/$GITHUB_REPOSITORY/actions/workflows/publish-download-pins.yml) after reviewing the released artifacts.")

existing=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -1)
if [ -n "$existing" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" \
    -f body="$body" >/dev/null
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
    -f body="$body" >/dev/null
fi
