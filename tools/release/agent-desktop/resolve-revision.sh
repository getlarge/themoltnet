#!/usr/bin/env bash
# Print `revision=<sha>` and `version=<x.y.z>` for a desktop release build.
#
# With RELEASE_TAG, the release-please draft decides: it must still be a
# draft, target a commit on main that its tag points to, and carry the
# matching package version. Without RELEASE_TAG this is a dry run of the
# checked-out commit, which is never published.
set -euo pipefail

if [ -z "${RELEASE_TAG:-}" ]; then
  echo "revision=$(git rev-parse HEAD)"
  echo "version=$(node -p "require('./apps/agent-desktop/package.json').version")"
  exit 0
fi

repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}
version=${RELEASE_TAG#agent-desktop-v}
[[ "$RELEASE_TAG" == agent-desktop-v* && "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "not a desktop release tag: $RELEASE_TAG" >&2
  exit 1
}
fail() { echo "desktop release $RELEASE_TAG: $*" >&2; exit 1; }

release=$(gh release view "$RELEASE_TAG" --repo "$repo" --json isDraft,targetCommitish)
[ "$(jq -r .isDraft <<< "$release")" = true ] || fail "is no longer a draft"
revision=$(jq -r .targetCommitish <<< "$release")
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "draft does not target an immutable commit"
[ "$(gh api "repos/$repo/commits/$RELEASE_TAG" --jq .sha)" = "$revision" ] ||
  fail "tag does not point at the draft's target commit"
case "$(gh api "repos/$repo/compare/$revision...main" --jq .status)" in
  ahead|identical) ;;
  *) fail "target commit $revision is not on main" ;;
esac
package_version=$(gh api "repos/$repo/contents/apps/agent-desktop/package.json?ref=$revision" \
  -H 'Accept: application/vnd.github.raw' | jq -r .version)
[ "$package_version" = "$version" ] || fail "package version at $revision is $package_version"

echo "revision=$revision"
echo "version=$version"
