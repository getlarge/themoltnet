#!/usr/bin/env bash
# Validate the unsigned PR package without production signing material.
set -euo pipefail
bundle=apps/agent-desktop/out-rust/bundle/aarch64-apple-darwin/release/bundle
app=$(find "$bundle/macos" -maxdepth 1 -name '*.app' -print -quit)
dmg=$(find "$bundle/dmg" -maxdepth 1 -name '*.dmg' -print -quit)
[ -d "$app" ] && [ -s "$dmg" ]
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
lipo "$app/Contents/MacOS/$executable" -verify_arch arm64
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")" = 13.0 ]
hdiutil verify "$dmg"
bash tools/release/agent-desktop/native-readiness-smoke.sh \
  mac-os "$app/Contents/MacOS/$executable"
