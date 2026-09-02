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
#   MOLTNET_AGENT_ALLOW_UNSIGNED=1  accept an artifact carrying the UNSIGNED
#       marker (local builds only — it waives the signing trust chain)
#   MOLTNET_AGENT_ALLOW_UNVERIFIED=1  skip release-signature verification
#       (local archives / releases published before signing existed — it
#       waives the publisher trust chain, use only for artifacts you built)
set -eu

REPO="getlarge/themoltnet"
HOME_DIR="${MOLTNET_AGENT_HOME:-$HOME/.local/share/moltnet/agent}"
BIN_DIR="${MOLTNET_AGENT_BIN_DIR:-$HOME/.local/bin}"
SERVICE_LABEL="net.themolt.agent.serve"

SENTINEL=.moltnet-agent-root
# Publisher release-signing key (ssh-ed25519, allowed_signers format). The
# archive checksum file is signed in CI with the matching private key
# (RELEASE_SIGNING_KEY secret); verifying here anchors trust in this script
# rather than in assets that live next to the archive they describe.
RELEASE_SIGNER_PRINCIPAL="releases@themolt.net"
RELEASE_SIGNER_PUBKEY=""

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

# Destructive operations only ever run inside a directory this installer
# created (marked with a sentinel). A mistyped MOLTNET_AGENT_HOME such as
# "$HOME" must never become an rm -rf target.
assert_owned_root() {
  case "$HOME_DIR" in
    /|"$HOME") die "refusing to operate on $HOME_DIR as the install root" ;;
    /*) ;;
    *) die "MOLTNET_AGENT_HOME must be an absolute path" ;;
  esac
  if [ -e "$HOME_DIR" ] && [ ! -e "$HOME_DIR/$SENTINEL" ]; then
    if [ -n "$(ls -A "$HOME_DIR" 2>/dev/null)" ]; then
      die "$HOME_DIR exists, is not empty, and was not created by this installer (missing $SENTINEL); refusing to touch it"
    fi
  fi
}

acquire_lock() {
  mkdir -p "$HOME_DIR"
  : > "$HOME_DIR/$SENTINEL"
  if ! mkdir "$HOME_DIR/.install-lock" 2>/dev/null; then
    die "another install/uninstall is in progress (remove $HOME_DIR/.install-lock if it is stale)"
  fi
}

# Must match the release workflow's build matrix exactly: a platform that
# detects as "supported" but is never published would request 404 assets.
RELEASED_PLATFORMS="darwin-arm64 linux-x64"

platform() {
  os=$(uname -s); arch=$(uname -m)
  case "$os" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported OS: $os" ;; esac
  # Rosetta reports x86_64 for a translated shell on Apple Silicon; the
  # native arm64 artifact is the right one for that hardware.
  if [ "$os" = darwin ] && [ "$arch" = x86_64 ] \
    && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    arch=arm64
  fi
  case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) die "unsupported arch: $arch" ;; esac
  plat="$os-$arch"
  case " $RELEASED_PLATFORMS " in
    *" $plat "*) ;;
    *) die "no moltnet-agent release exists for $plat yet (released: $RELEASED_PLATFORMS)" ;;
  esac
  printf '%s' "$plat"
}

# Verify the checksum file's detached signature against the embedded
# publisher key. Without a signature (or without the embedded key) the
# install fails closed unless explicitly waived.
verify_release_signature() {
  checksum_to_verify=$1; sig=$2
  if [ "${MOLTNET_AGENT_ALLOW_UNVERIFIED:-0}" = 1 ]; then
    log "warning: release-signature verification waived (MOLTNET_AGENT_ALLOW_UNVERIFIED=1)"
    return 0
  fi
  [ -n "$RELEASE_SIGNER_PUBKEY" ] \
    || die "this installer has no embedded release key; set MOLTNET_AGENT_ALLOW_UNVERIFIED=1 only for artifacts you built yourself"
  [ -s "$sig" ] \
    || die "release signature missing for $checksum_to_verify; refusing to install (MOLTNET_AGENT_ALLOW_UNVERIFIED=1 to waive for self-built artifacts)"
  command -v ssh-keygen >/dev/null 2>&1 || die "ssh-keygen is required to verify the release signature"
  signers=$(mktemp)
  printf '%s namespaces="moltnet-release" %s\n' "$RELEASE_SIGNER_PRINCIPAL" "$RELEASE_SIGNER_PUBKEY" > "$signers"
  if ! ssh-keygen -Y verify -f "$signers" -I "$RELEASE_SIGNER_PRINCIPAL" \
    -n moltnet-release -s "$sig" < "$checksum_to_verify" >/dev/null 2>&1; then
    rm -f "$signers"
    die "release signature verification FAILED for $checksum_to_verify — the artifact may have been tampered with"
  fi
  rm -f "$signers"
  log "release signature verified"
}

# Versions become filesystem path segments under $HOME_DIR: reject anything
# empty or path-hostile before it can turn a cleanup into `rm -rf` of the root.
validate_version() {
  case "$1" in
    ''|*[!0-9A-Za-z.+-]*|.*) die "refusing unsafe version string: '$1'" ;;
  esac
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
  # The login service runs `moltnet-agent serve`. Distinguish a release
  # that simply lacks the subcommand (skip quietly) from a broken binary
  # (fail loudly so the caller can roll back).
  serve_help_output=$("$HOME_DIR/current/bin/moltnet-agent" serve --help 2>&1)
  serve_help_status=$?
  if [ "$serve_help_status" != 0 ]; then
    if printf '%s' "$serve_help_output" | grep -qi "unknown command"; then
      log "this moltnet-agent release has no 'serve' command; login service not registered (run daemons with 'moltnet-agent poll' for now)"
      return 0
    fi
    log "installed binary failed its self-check:"
    printf '%s\n' "$serve_help_output" | tail -5 >&2
    return 1
  fi
  case "$1" in
    darwin-*)
      plist="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
      mkdir -p "$(dirname "$plist")"
      launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      service_plist > "$plist"
      launchctl bootstrap "gui/$(id -u)" "$plist"
      launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      sleep 2
      if ! launchctl print "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null | grep -q "state = running"; then
        tail -20 "$HOME_DIR/serve.log" 2>/dev/null >&2 || true
        log "LaunchAgent $SERVICE_LABEL did not reach running state"
        return 1
      fi
      log "LaunchAgent $SERVICE_LABEL registered ($plist)"
      ;;
    linux-*)
      if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
        unit="$HOME/.config/systemd/user/moltnet-agent.service"
        mkdir -p "$(dirname "$unit")"
        service_unit > "$unit"
        systemctl --user daemon-reload
        systemctl --user enable --now moltnet-agent.service
        # enable --now is a no-op for an already-active unit: force the
        # upgrade to actually run the newly installed version.
        systemctl --user try-restart moltnet-agent.service 2>/dev/null || true
        sleep 2
        if ! systemctl --user is-active --quiet moltnet-agent.service; then
          journalctl --user -u moltnet-agent.service -n 10 --no-pager 2>/dev/null | tail -10 >&2 || true
          log "moltnet-agent.service failed to start after install"
          return 1
        fi
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
  assert_owned_root
  if [ ! -e "$HOME_DIR/$SENTINEL" ]; then
    log "nothing to uninstall at $HOME_DIR"
    rm -f "$BIN_DIR/moltnet-agent"
    unregister_service
    return 0
  fi
  acquire_lock
  trap 'rmdir "$HOME_DIR/.install-lock" 2>/dev/null || true' EXIT
  unregister_service
  rm -f "$BIN_DIR/moltnet-agent"
  rmdir "$HOME_DIR/.install-lock" 2>/dev/null || true
  trap - EXIT
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
    signature_file="$archive.sha256.sig"
    version=$(tar -xzOf "$archive" "$name/manifest.json" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"//')
  else
    version="${MOLTNET_AGENT_VERSION:-$(latest_version)}"
    [ -n "$version" ] || die "could not determine the latest version (set MOLTNET_AGENT_VERSION)"
    base="${MOLTNET_AGENT_BASE_URL:-https://github.com/$REPO/releases/download/agent-daemon-v$version}"
    archive="$work/$name.tar.gz"; checksum_file="$archive.sha256"
    log "downloading moltnet-agent $version ($plat)…"
    curl -fsSL "$base/$name.tar.gz" -o "$archive"
    curl -fsSL "$base/$name.tar.gz.sha256" -o "$checksum_file"
    signature_file="$archive.sha256.sig"
    curl -fsSL "$base/$name.tar.gz.sha256.sig" -o "$signature_file" 2>/dev/null || : > "$signature_file"
  fi

  verify_release_signature "$checksum_file" "$signature_file"
  expected=$(cut -d' ' -f1 "$checksum_file")
  actual=$(sha256 "$archive")
  [ "$expected" = "$actual" ] || die "checksum mismatch for $name.tar.gz"

  validate_version "$version"
  target="$HOME_DIR/$version"
  case "$target" in "$HOME_DIR"/?*) ;; *) die "install target escapes $HOME_DIR" ;; esac

  assert_owned_root
  # One install at a time per root; a stale lock means a crashed installer.
  acquire_lock
  trap 'rmdir "$HOME_DIR/.install-lock" 2>/dev/null; rm -rf "$work"' EXIT
  if [ -x "$target/bin/moltnet-agent" ] && [ "$(readlink "$HOME_DIR/current" 2>/dev/null)" = "$target" ]; then
    log "moltnet-agent $version already installed"
  else
    staging=$(mktemp -d "$HOME_DIR/.staging.XXXXXX")
    tar -xzf "$archive" -C "$staging" --strip-components 1
    if [ -e "$staging/UNSIGNED" ] && [ "${MOLTNET_AGENT_ALLOW_UNSIGNED:-0}" != 1 ]; then
      rm -rf "$staging"
      die "this artifact is marked UNSIGNED (built without the release signing identity); refusing to install it. Set MOLTNET_AGENT_ALLOW_UNSIGNED=1 only if you built it yourself."
    fi
    rm -rf "$target"; mv "$staging" "$target"
    previous_target=$(readlink "$HOME_DIR/current" 2>/dev/null || true)
    ln -sfn "$target" "$HOME_DIR/current"
    log "installed to $target"
  fi

  mkdir -p "$BIN_DIR"
  ln -sfn "$HOME_DIR/current/bin/moltnet-agent" "$BIN_DIR/moltnet-agent"
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) log "note: add $BIN_DIR to your PATH" ;; esac

  # Truncate an unbounded crash-loop log before (re)starting the service.
  if [ -f "$HOME_DIR/serve.log" ] && [ "$(wc -c < "$HOME_DIR/serve.log")" -gt 10485760 ]; then
    tail -c 1048576 "$HOME_DIR/serve.log" > "$HOME_DIR/serve.log.tmp" \
      && mv "$HOME_DIR/serve.log.tmp" "$HOME_DIR/serve.log"
  fi

  if ! register_service "$plat"; then
    # Roll back: restore the previous version and its service; keep the
    # broken one on disk for inspection, clearly named.
    if [ -n "${previous_target:-}" ] && [ -d "$previous_target" ] && [ "$previous_target" != "$target" ]; then
      ln -sfn "$previous_target" "$HOME_DIR/current"
      mv "$target" "$target.broken" 2>/dev/null || true
      register_service "$plat" || true
      die "upgrade to $version failed its readiness check; rolled back to $(basename "$previous_target") (broken payload kept at $target.broken)"
    fi
    die "install of $version failed its readiness check"
  fi

  # Prune older versions only after the new one is confirmed running.
  for dir in "$HOME_DIR"/*/; do
    dir=${dir%/}
    case "$dir" in "$target"|*/current|*/.install-lock|*/.staging.*|*.broken) ;; *) rm -rf "$dir" ;; esac
  done

  case "$plat" in
    linux-*)
      # The darwin bundle vendors qemu-img; on Linux both the image tool and
      # the system emulator come from the distro (same contract as the
      # daemon GitHub Action setup).
      command -v qemu-img >/dev/null 2>&1 \
        || log "note: qemu-img not found — sandboxed (gondolin) runs need it: apt install qemu-utils / dnf install qemu-img"
      command -v qemu-system-x86_64 >/dev/null 2>&1 \
        || log "note: qemu-system-x86_64 not found — sandboxed (gondolin) runs need it: apt install qemu-system-x86 / dnf install qemu-system-x86"
      ;;
  esac
  if "$HOME_DIR/current/bin/moltnet-agent" serve --help >/dev/null 2>&1; then
    log "moltnet-agent $version ready — open the Console's Local runtime page to pair."
  else
    log "moltnet-agent $version ready."
  fi
}

case "${1:-}" in
  --uninstall) uninstall ;;
  -h|--help) sed -n '2,17p' "$0" ;;
  "") install ;;
  *) die "unknown argument: $1" ;;
esac
