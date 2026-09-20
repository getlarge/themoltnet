#!/usr/bin/env bash
# Exercise the packaged executable and WebKit on the Ubuntu release baseline.
# Full approval and worker acceptance remains a separate desktop walkthrough.
set -euo pipefail
bundle=apps/agent-desktop/out-rust/bundle/x86_64-unknown-linux-gnu/release/bundle
deb=$(find "$bundle/deb" -maxdepth 1 -name '*.deb' -print -quit)
appimage=$(find "$bundle/appimage" -maxdepth 1 -name '*.AppImage' -print -quit)
[ -s "$deb" ] && [ -s "$appimage" ]
[ "$(dpkg-deb -f "$deb" Architecture)" = amd64 ]
sudo apt-get install -y "$(realpath "$deb")"
command -v moltnet-agent-desktop
if ldd /usr/bin/moltnet-agent-desktop | grep -q 'not found'; then
  echo 'The installed executable has unresolved shared libraries' >&2
  exit 1
fi
for format in deb appimage; do
  executable=/usr/bin/moltnet-agent-desktop
  if [ "$format" = appimage ]; then
    executable=$(realpath "$appimage")
    chmod +x "$executable"
  fi
  config=$(mktemp -d)
  result=0
  XDG_CONFIG_HOME="$config" xvfb-run -a dbus-run-session -- timeout 15s "$executable" > "/tmp/moltnet-desktop-smoke-$format.log" 2>&1 || result=$?
  rm -rf "$config"
  # A healthy window stays open until timeout. Immediate crashes are failures.
  [ "$result" = 124 ] || { cat "/tmp/moltnet-desktop-smoke-$format.log"; exit 1; }
done
