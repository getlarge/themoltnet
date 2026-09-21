#!/usr/bin/env bash
# Require the draft, tag, checkout, and target revision to remain identical.
set -euo pipefail

revision=$(git rev-parse HEAD)
release=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,targetCommitish)
draft=$(jq -r .isDraft <<< "$release")
target=$(jq -r .targetCommitish <<< "$release")
tag_revision=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_TAG}" --jq .sha)

if [ "$draft" != true ]; then
  echo "desktop release $RELEASE_TAG is no longer a draft" >&2
  exit 1
fi
if [ "$target" != "$revision" ]; then
  echo "desktop release $RELEASE_TAG targets $target, but this job checked out $revision" >&2
  exit 1
fi
if [ "$tag_revision" != "$revision" ]; then
  echo "desktop tag $RELEASE_TAG resolves to $tag_revision, but this job checked out $revision" >&2
  exit 1
fi
