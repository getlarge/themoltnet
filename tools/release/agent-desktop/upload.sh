#!/usr/bin/env bash
# Upload one platform; publication is gated on both platform jobs.
set -euo pipefail
bash tools/release/agent-desktop/verify-release-revision.sh
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
bash tools/release/agent-desktop/verify-release-revision.sh
