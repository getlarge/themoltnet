#!/usr/bin/env bash
# Require the immutable draft revision shared by every platform job.
set -euo pipefail
release=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,targetCommitish)
[ "$(jq -r .isDraft <<< "$release")" = "true" ] || {
  echo "desktop release $RELEASE_TAG is already published" >&2
  exit 1
}
revision=$(jq -r .targetCommitish <<< "$release")
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
  echo "desktop draft $RELEASE_TAG does not identify an immutable release revision" >&2
  exit 1
}
git fetch --no-tags origin main
git fetch --no-tags origin "$revision"
git merge-base --is-ancestor "$revision" origin/main || {
  echo "desktop draft $RELEASE_TAG does not target a commit on main" >&2
  exit 1
}
tag_revision=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_TAG}" --jq .sha)
[ "$tag_revision" = "$revision" ] || {
  echo "desktop tag $RELEASE_TAG does not match its draft revision" >&2
  exit 1
}
git checkout --detach "$revision"
version=${RELEASE_TAG#agent-desktop-v}
package_version=$(node -p "require('./apps/agent-desktop/package.json').version")
[ "$package_version" = "$version" ] || {
  echo "desktop release tag $RELEASE_TAG does not match package version $package_version" >&2
  exit 1
}
