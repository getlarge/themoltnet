#!/usr/bin/env bash
# Verify signed updater artifacts and copy them to stable release names.
set -euo pipefail

platform=${1:?usage: materialize.sh <mac-os|linux> <version> <updater-public-key>}
version=${2:?usage: materialize.sh <mac-os|linux> <version> <updater-public-key>}
public_key=${3:?usage: materialize.sh <mac-os|linux> <version> <updater-public-key>}
target_dir=apps/agent-desktop/out-rust/bundle
output=dist/agent-desktop
mkdir -p "$output"
source "$(dirname "$0")/find-one.sh"

verify() {
  local target=$1 signature=$2 artifact=$3
  cargo run --manifest-path apps/agent-desktop/src-tauri/Cargo.toml --locked --release \
    --target "$target" --target-dir "$target_dir" --bin verify-updater-signature -- \
    "$public_key" "$signature" "$artifact"
}

case "$platform" in
  mac-os)
    target=aarch64-apple-darwin
    bundle=$target_dir/$target/release/bundle
    # Tauri's canonical app and updater names do not contain a version. bundle.sh
    # removes this target's prior bundle directory before each build.
    app=$(find_one "$bundle/macos" 'MoltNet Agent.app' d)
    dmg=$(find_one "$bundle/dmg" "*_${version}_*.dmg")
    updater=$(find_one "$bundle/macos" 'MoltNet Agent.app.tar.gz')
    signature=$updater.sig
    [ -d "$app" ] && [ -s "$dmg" ] && [ -s "$updater" ] && [ -s "$signature" ] || {
      echo 'refusing incomplete Agent desktop macOS artifacts' >&2
      exit 1
    }
    verify "$target" "$signature" "$updater"
    codesign --verify --deep --strict --verbose=2 "$app"
    spctl --assess --type execute --verbose=2 "$app"
    xcrun stapler validate "$app"
    xcrun stapler validate "$dmg"
    [ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")" = '13.0' ]
    ditto -c -k --keepParent "$app" "$output/MoltNet-Agent_${version}_aarch64.app.zip"
    cp "$dmg" "$output/MoltNet-Agent_${version}_aarch64.dmg"
    cp "$updater" "$output/MoltNet-Agent_${version}_aarch64.app.tar.gz"
    cp "$signature" "$output/MoltNet-Agent_${version}_aarch64.app.tar.gz.sig"
    ;;
  linux)
    target=x86_64-unknown-linux-gnu
    bundle=$target_dir/$target/release/bundle
    for format in deb AppImage; do
      matches=$(find "$bundle" -type f -name "*_${version}_*.$format" -print)
      count=$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')
      [ "$count" = 1 ] || {
        echo "Expected exactly one version $version $format; found $count" >&2
        exit 1
      }
      artifact=$matches
      [ -s "$artifact" ] && [ -s "$artifact.sig" ] || {
        echo "Missing signed $format" >&2
        exit 1
      }
      verify "$target" "$artifact.sig" "$artifact"
      cp "$artifact" "$output/MoltNet-Agent_${version}_amd64.$format"
      cp "$artifact.sig" "$output/MoltNet-Agent_${version}_amd64.$format.sig"
    done
    [ "$(dpkg-deb -f "$output/MoltNet-Agent_${version}_amd64.deb" Architecture)" = amd64 ]
    [ "$(dpkg-deb -f "$output/MoltNet-Agent_${version}_amd64.deb" Version)" = "$version" ]
    ;;
  *)
    echo "unknown desktop platform: $platform" >&2
    exit 1
    ;;
esac
