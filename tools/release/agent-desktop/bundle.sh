#!/usr/bin/env bash
# The same platform build serves local/PR packaging and signed releases.
set -euo pipefail
platform=${1:?Specify mac-os or linux}
mode=${2:-unsigned}
args=()
case "$platform" in
  mac-os) args+=(--bundles app,dmg --target aarch64-apple-darwin) ;;
  linux) args+=(--bundles deb,appimage --target x86_64-unknown-linux-gnu --config src-tauri/tauri.linux.conf.json) ;;
  *) echo "Unknown desktop platform: $platform" >&2; exit 1 ;;
esac
case "$mode" in
  unsigned) args+=(--config '{"bundle":{"createUpdaterArtifacts":false}}') ;;
  release)
    : "${TAURI_CONFIG:?Release packaging requires the updater public-key config}"
    : "${TAURI_SIGNING_PRIVATE_KEY:?Release packaging requires the signing key}"
    args+=(--config "$TAURI_CONFIG")
    ;;
  *) echo "Unknown packaging mode: $mode" >&2; exit 1 ;;
esac
CARGO_TARGET_DIR=../out-rust/bundle pnpm --dir apps/agent-desktop exec tauri build "${args[@]}"
