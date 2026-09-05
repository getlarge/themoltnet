#!/usr/bin/env bash
# Advance the internal Go module pins in apps/moltnet-cli/go.mod to the versions
# recorded in the release manifest. The caller opens the resulting reviewable PR.
#
# go.work makes every local build resolve the worktree source, so a stale pin is
# invisible until the release runs goreleaser with GOWORK=off and silently ships
# an old client. That is the failure release-recover-cli.yml exists to undo.
#
# Run locally (edits your worktree, opens nothing):
#   bash tools/release/sync-cli-go-mod.sh
#
# Environment:
#   API_CLIENT_VERSION     target moltnet-api-client version; blank reads the manifest
#   DSPY_ADAPTERS_VERSION  target dspy-adapters version; blank reads the manifest
#   MANIFEST               release-please manifest path
#   CLI_DIR                the module whose pins are advanced
set -euo pipefail

MANIFEST=${MANIFEST:-.release-please-manifest.json}
CLI_DIR=${CLI_DIR:-apps/moltnet-cli}

# Every `go` invocation below must ignore go.work: the whole point is to
# exercise the published module versions goreleaser will resolve, not the
# worktree source that go.work would substitute.
export GOWORK=off

manifest_version() { jq -er --arg key "libs/$1" '.[$key]' "$MANIFEST"; }

current_pin() {
  awk -v module="github.com/getlarge/themoltnet/libs/$1" \
    '$1 == module { print substr($2, 2); exit }' "$CLI_DIR/go.mod"
}

valid_version() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

# name -> the requested version, after tag-prefix stripping and manifest fallback.
resolve_target() {
  local name=$1 candidate=$2
  candidate=${candidate#"$name"-v}
  candidate=${candidate:-$(manifest_version "$name")}
  valid_version "$candidate" || { echo "invalid $name version: $candidate" >&2; exit 2; }
  printf '%s' "$candidate"
}

advance_pin() {
  local name=$1 candidate=$2 current module resolved
  candidate=$(resolve_target "$name" "$candidate")
  current=$(current_pin "$name")
  [ -n "$current" ] || { echo "missing $name pin in $CLI_DIR/go.mod" >&2; exit 2; }
  # Do not regress a deliberately ahead pin: only advance strictly forward.
  [ "$(printf '%s\n%s\n' "$current" "$candidate" | sort -V | tail -1)" = "$candidate" ] || return 0
  [ "$current" = "$candidate" ] && return 0

  module="github.com/getlarge/themoltnet/libs/$name"
  echo "::group::go get ${module}@v${candidate}"
  (cd "$CLI_DIR" && go get "${module}@v${candidate}")
  # `go get` succeeding is not proof the pin moved: a module proxy that has not
  # yet caught up with a just-pushed tag leaves MVS on the old version.
  resolved=$(cd "$CLI_DIR" && go list -m "$module" | awk '{print $2}')
  [ "$resolved" = "v${candidate}" ] || {
    echo "requested v${candidate} for $name but MVS resolved ${resolved}" >&2
    exit 1
  }
  echo "::endgroup::"
  changed=true
}

changed=false
advance_pin moltnet-api-client "${API_CLIENT_VERSION:-}"
advance_pin dspy-adapters "${DSPY_ADAPTERS_VERSION:-}"

[ "$changed" = true ] || { echo "go.mod pins are current or ahead"; exit 0; }

(cd "$CLI_DIR" && go mod tidy && go build ./...)
