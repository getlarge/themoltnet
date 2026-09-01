#!/bin/sh
# moltnet-agent installer — `curl -fsSL https://get.themolt.net | sh` (#2063).
#
# Downloads the signed, checksum-verified bundle for this machine, installs
# it under ~/.local/share/moltnet/agent/<version>, links `moltnet-agent`
# on PATH, and registers `moltnet-agent serve` as a login service
# (LaunchAgent on macOS, systemd user unit on Linux). Idempotent: re-running
# upgrades in place; `--uninstall` removes everything it created.
#
# Environment overrides (mostly for CI and local testing):
#   MOLTNET_AGENT_VERSION   version to install (default: latest release)
#   MOLTNET_AGENT_BASE_URL  release asset base URL
#   MOLTNET_AGENT_ARCHIVE   path to a local .tar.gz (skips download; .sha256 beside it)
#   MOLTNET_AGENT_HOME      install root (default ~/.local/share/moltnet/agent)
#   MOLTNET_AGENT_BIN_DIR   where the `moltnet-agent` link goes (default ~/.local/bin)
#   MOLTNET_AGENT_NO_SERVICE=1  skip service registration
set -eu

REPO="getlarge/themoltnet"
HOME_DIR="${MOLTNET_AGENT_HOME:-$HOME/.local/share/moltnet/agent}"
BIN_DIR="${MOLTNET_AGENT_BIN_DIR:-$HOME/.local/bin}"
SERVICE_LABEL="net.themolt.agent.serve"

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

platform() {
  os=$(uname -s); arch=$(uname -m)
  case "$os" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported OS: $os" ;; esac
  case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) die "unsupported arch: $arch" ;; esac
  printf '%s-%s' "$os" "$arch"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

latest_version() {
  # Bundle releases are tagged `agent-daemon-v<semver>` by release-please.
  curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" \
    | grep -o '"tag_name": *"agent-daemon-v[^"]*"' | head -1 | sed 's/.*agent-daemon-v//; s/"//'
}

service_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$HOME_DIR/current/bin/moltnet-agent</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/serve.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/serve.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
</dict></plist>
EOF
}

service_unit() {
  cat <<EOF
[Unit]
Description=MoltNet agent supervisor (moltnet-agent serve)
After=network-online.target

[Service]
ExecStart=$HOME_DIR/current/bin/moltnet-agent serve
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
}

register_service() {
  [ "${MOLTNET_AGENT_NO_SERVICE:-0}" = 1 ] && { log "service registration skipped"; return; }
  # The login service runs `moltnet-agent serve`; a daemon release without
  # that subcommand would just crash-loop under KeepAlive.
  if ! "$HOME_DIR/current/bin/moltnet-agent" serve --help >/dev/null 2>&1; then
    log "this moltnet-agent release has no 'serve' command; login service not registered (run daemons with 'moltnet-agent poll' for now)"
    return
  fi
  case "$1" in
    darwin-*)
      plist="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
      mkdir -p "$(dirname "$plist")"
      launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      service_plist > "$plist"
      launchctl bootstrap "gui/$(id -u)" "$plist"
      launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      log "LaunchAgent $SERVICE_LABEL registered ($plist)"
      ;;
    linux-*)
      if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
        unit="$HOME/.config/systemd/user/moltnet-agent.service"
        mkdir -p "$(dirname "$unit")"
        service_unit > "$unit"
        systemctl --user daemon-reload
        systemctl --user enable --now moltnet-agent.service
        log "systemd user unit moltnet-agent.service enabled"
      else
        log "no systemd user session; start 'moltnet-agent serve' yourself (headless mode)"
      fi
      ;;
  esac
}

unregister_service() {
  case "$(platform)" in
    darwin-*)
      launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      rm -f "$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
      ;;
    linux-*)
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user disable --now moltnet-agent.service >/dev/null 2>&1 || true
      fi
      rm -f "$HOME/.config/systemd/user/moltnet-agent.service"
      ;;
  esac
}

uninstall() {
  unregister_service
  rm -f "$BIN_DIR/moltnet-agent"
  rm -rf "$HOME_DIR"
  log "moltnet-agent removed (config in ~/.config/moltnet was kept)"
}

install() {
  plat=$(platform)
  name="moltnet-agent-$plat"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  if [ -n "${MOLTNET_AGENT_ARCHIVE:-}" ]; then
    archive="$MOLTNET_AGENT_ARCHIVE"
    checksum_file="$archive.sha256"
    version=$(tar -xzOf "$archive" "$name/manifest.json" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"//')
  else
    version="${MOLTNET_AGENT_VERSION:-$(latest_version)}"
    [ -n "$version" ] || die "could not determine the latest version (set MOLTNET_AGENT_VERSION)"
    base="${MOLTNET_AGENT_BASE_URL:-https://github.com/$REPO/releases/download/agent-daemon-v$version}"
    archive="$work/$name.tar.gz"; checksum_file="$archive.sha256"
    log "downloading moltnet-agent $version ($plat)…"
    curl -fsSL "$base/$name.tar.gz" -o "$archive"
    curl -fsSL "$base/$name.tar.gz.sha256" -o "$checksum_file"
  fi

  expected=$(cut -d' ' -f1 "$checksum_file")
  actual=$(sha256 "$archive")
  [ "$expected" = "$actual" ] || die "checksum mismatch for $name.tar.gz"

  target="$HOME_DIR/$version"
  if [ -x "$target/bin/moltnet-agent" ] && [ "$(readlink "$HOME_DIR/current" 2>/dev/null)" = "$target" ]; then
    log "moltnet-agent $version already installed"
  else
    rm -rf "$target.partial"; mkdir -p "$target.partial"
    tar -xzf "$archive" -C "$target.partial" --strip-components 1
    rm -rf "$target"; mv "$target.partial" "$target"
    ln -sfn "$target" "$HOME_DIR/current"
    log "installed to $target"
  fi

  mkdir -p "$BIN_DIR"
  ln -sfn "$HOME_DIR/current/bin/moltnet-agent" "$BIN_DIR/moltnet-agent"
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) log "note: add $BIN_DIR to your PATH" ;; esac

  # Prune older versions (keep current).
  for dir in "$HOME_DIR"/*/; do
    dir=${dir%/}
    case "$dir" in "$target"|*/current) ;; *) rm -rf "$dir" ;; esac
  done

  register_service "$plat"
  case "$plat" in
    linux-*)
      # The darwin bundle vendors qemu-img; on Linux it comes from the distro.
      command -v qemu-img >/dev/null 2>&1 \
        || log "note: qemu-img not found — sandboxed (gondolin) runs need it: apt install qemu-utils / dnf install qemu-img"
      ;;
  esac
  log "moltnet-agent $version ready — open the Console's Local runtime page to pair."
}

case "${1:-}" in
  --uninstall) uninstall ;;
  -h|--help) sed -n '2,17p' "$0" ;;
  "") install ;;
  *) die "unknown argument: $1" ;;
esac
