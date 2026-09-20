#!/usr/bin/env bash
# Upload one platform; publication is gated on both platform jobs.
set -euo pipefail
revision=$(git rev-parse HEAD)
verify_release_revision() {
  local release
  release=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,targetCommitish)
  [ "$(jq -r .isDraft <<< "$release")" = "true" ] &&
    [ "$(jq -r .targetCommitish <<< "$release")" = "$revision" ] &&
    [ "$(gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_TAG}" --jq .sha)" = "$revision" ] || {
      echo "desktop release $RELEASE_TAG changed during packaging" >&2
      exit 1
    }
}

verify_release_revision
gh release upload "$RELEASE_TAG" dist/agent-desktop/* --clobber
mkdir -p "$RUNNER_TEMP/agent-desktop-uploaded"
for artifact in dist/agent-desktop/*; do
  name=$(basename "$artifact")
  gh release download "$RELEASE_TAG" \
    --pattern "$name" \
    --dir "$RUNNER_TEMP/agent-desktop-uploaded" \
    --clobber
  cmp --silent "$artifact" "$RUNNER_TEMP/agent-desktop-uploaded/$name" || {
    echo "uploaded artifact verification failed: $name" >&2
    exit 1
  }
done
verify_release_revision
