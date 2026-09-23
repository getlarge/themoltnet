#!/usr/bin/env bash
# Publish a complete, verified desktop release directory to its draft:
# re-check the draft revision, add the updater manifest, upload everything
# once, wait for GitHub's server-side digests to match, then un-draft.
#
#   RELEASE_TAG=agent-desktop-vX.Y.Z REVISION=<sha> publish.sh <assets-dir>
set -euo pipefail

assets=${1:?usage: publish.sh <assets-dir>}
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}
here=$(dirname "$0")

resolved=$(bash "$here/resolve-revision.sh")
[ "$(sed -n 's/^revision=//p' <<< "$resolved")" = "${REVISION:?REVISION is required}" ] || {
  echo "desktop draft $RELEASE_TAG no longer targets the packaged revision $REVISION" >&2
  exit 1
}
version=$(sed -n 's/^version=//p' <<< "$resolved")

node "$here/manifest.mjs" "$assets" "$version" "$repo"
gh release upload "$RELEASE_TAG" "$assets"/* --repo "$repo" --clobber

# Read the asset list from its own endpoint: the release object's embedded
# asset list can lag behind uploads.
release_id=$(gh release view "$RELEASE_TAG" --repo "$repo" --json databaseId --jq .databaseId)
published="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/agent-desktop-published-assets.json"
for attempt in $(seq 1 20); do
  gh api --paginate "repos/$repo/releases/$release_id/assets?per_page=100" |
    jq -s 'add' > "$published"
  status=0
  node "$here/verify-published-assets.mjs" "$assets" "$version" "$published" || status=$?
  [ "$status" = 0 ] && break
  [ "$status" = 75 ] && [ "$attempt" -lt 20 ] || exit "$status"
  sleep "${PUBLISH_POLL_SECONDS:-6}"
done

gh release edit "$RELEASE_TAG" --repo "$repo" --draft=false
echo "published $RELEASE_TAG at $REVISION"
