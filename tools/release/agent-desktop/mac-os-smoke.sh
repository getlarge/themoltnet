#!/usr/bin/env bash
# Validate the unsigned PR package without production signing material.
set -euo pipefail
bundle=apps/agent-desktop/out-rust/bundle/aarch64-apple-darwin/release/bundle
app=$(find "$bundle/macos" -maxdepth 1 -name '*.app' -print -quit)
dmg=$(find "$bundle/dmg" -maxdepth 1 -name '*.dmg' -print -quit)
[ -d "$app" ] && [ -s "$dmg" ]
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
lipo "$app/Contents/MacOS/$executable" -verify_arch arm64
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")" = 15.0 ]
# Info.plist echoes the config; the Mach-O load command shows what the
# toolchain actually linked for, which a newer runner SDK could raise.
for binary in "$app"/Contents/MacOS/*; do
  build=$(otool -l "$binary" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { minos = $2 } found && $1 == "sdk" { print minos, $2; exit }')
  echo "$(basename "$binary"): minos/sdk $build"
  [ "${build%% *}" = 15.0 ]
done
hdiutil verify "$dmg"
bash tools/release/agent-desktop/native-readiness-smoke.sh \
  mac-os "$app/Contents/MacOS/$executable"
