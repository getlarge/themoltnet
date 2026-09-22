#!/usr/bin/env bash
# The same platform build serves local/PR packaging and signed releases.
set -euo pipefail
platform=${1:?Specify mac-os or linux}
mode=${2:-unsigned}
args=()
case "$platform" in
  host)
    case "$(uname -s)" in
      Darwin) platform=mac-os ;;
      Linux) platform=linux ;;
      *) echo "Unsupported desktop packaging host: $(uname -s)" >&2; exit 1 ;;
    esac
    ;;
esac
case "$platform" in
  mac-os)
    target=aarch64-apple-darwin
    args+=(--bundles app,dmg --target "$target")
    ;;
  linux)
    target=x86_64-unknown-linux-gnu
    args+=(--bundles deb,appimage --target "$target" --config src-tauri/tauri.linux.conf.json)
    ;;
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
node tools/release/agent-desktop/verify-boundary.mjs --config-only -- "${args[@]}"
# Tauri's macOS app/updater names are unversioned. Remove only prior bundle
# products so stale outputs cannot pass release artifact selection.
rm -rf "apps/agent-desktop/out-rust/bundle/$target/release/bundle"
CARGO_TARGET_DIR=../out-rust/bundle pnpm --dir apps/agent-desktop exec tauri build "${args[@]}"
node tools/release/agent-desktop/verify-boundary.mjs --binary "apps/agent-desktop/out-rust/bundle/$target/release/moltnet-agent-desktop" -- "${args[@]}"
