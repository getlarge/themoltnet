#!/usr/bin/env bash
# One package list for native tests, PR packages, and signed Linux releases.
set -euo pipefail

sudo apt-get update
sudo apt-get install -y \
  build-essential \
  dbus-x11 \
  file \
  libayatana-appindicator3-dev \
  libfuse2t64 \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  patchelf \
  xvfb
