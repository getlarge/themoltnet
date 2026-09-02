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
RELEASE_SIGNER_PRINCIPAL="legreffier@themolt.net"
# Injected at release time from the RELEASE_SIGNER_PUBKEY repo variable (the
# CI cross-checks it against the signing key before uploading). Deliberately
# NOT fetched at install time: the trust anchor must live in the script the
# user chose to run, never in state the release publisher can also rotate.
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

# The mutation lock is a SIBLING of the install root, not inside it, so
# uninstall can hold it while removing the tree itself — releasing it first
# would let a concurrent install start extracting into a directory that is
# mid-deletion.
LOCK_DIR="${HOME_DIR%/}.lock"
acquire_lock() {
  mkdir -p "$HOME_DIR"
  : > "$HOME_DIR/$SENTINEL"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "another install/uninstall is in progress (remove $LOCK_DIR if it is stale)"
  fi
}
release_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

# Host detection is deliberately separate from release-download eligibility:
# uninstall and service management must keep working even if the release
# matrix later drops or renames this platform.
host_os() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) die "unsupported OS: $(uname -s)" ;;
  esac
}

service_definition_path() {
  case "$(host_os)" in
    darwin) printf '%s' "$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist" ;;
    linux) printf '%s' "$HOME/.config/systemd/user/moltnet-agent.service" ;;
  esac
}

# Must match the release workflow's build matrix exactly: a platform that
# detects as "supported" but is never published would request 404 assets.
RELEASED_PLATFORMS="darwin-arm64 linux-x64"

platform() {
  os=$(host_os); arch=$(uname -m)
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

# Bounded transport policy for release assets: connection deadline, overall
# deadline, and retries on transient failures.
fetch_url() {
  curl -fsSL --retry 3 --retry-connrefused --connect-timeout 15 --max-time 600 -o "$2" "$1"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

latest_version() {
  # Bundle releases are tagged `agent-daemon-v<semver>` by release-please.
  curl -fsSL --retry 3 --connect-timeout 15 --max-time 60 \
    "https://api.github.com/repos/$REPO/releases?per_page=50" \
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
  # Service-independent smoke check FIRST: even with registration skipped
  # (MOLTNET_AGENT_NO_SERVICE=1), a launcher that cannot execute at all must
  # fail the install — the headless path would otherwise replace and prune
  # the last working version.
  if ! smoke_out=$("$HOME_DIR/current/bin/moltnet-agent" --help 2>&1); then
    log "installed binary failed its self-check (--help):"
    printf '%s\n' "$smoke_out" | tail -5 >&2
    return 1
  fi
  [ "${MOLTNET_AGENT_NO_SERVICE:-0}" = 1 ] && { log "service registration skipped"; return 0; }
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
  case "$(host_os)" in
    darwin)
      launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
      rm -f "$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
      ;;
    linux)
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
    # Nothing provably ours at this root: remove only artifacts that
    # verifiably point INTO $HOME_DIR — never an unrelated executable or a
    # user-managed service definition.
    log "no installer-owned root at $HOME_DIR"
    case "$(readlink "$BIN_DIR/moltnet-agent" 2>/dev/null)" in
      "$HOME_DIR"/*) rm -f "$BIN_DIR/moltnet-agent" ;;
    esac
    service_file=$(service_definition_path)
    if [ -f "$service_file" ] && grep -qF "$HOME_DIR/current" "$service_file"; then
      unregister_service
    fi
    return 0
  fi
  acquire_lock
  trap 'release_lock' EXIT
  unregister_service
  rm -f "$BIN_DIR/moltnet-agent"
  # Hold the lock through the removal: the tree must be gone before any
  # concurrent install may proceed.
  rm -rf "$HOME_DIR"
  release_lock
  trap - EXIT
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
    fetch_url "$base/$name.tar.gz" "$archive" || die "downloading $name.tar.gz failed"
    fetch_url "$base/$name.tar.gz.sha256" "$checksum_file" || die "downloading $name.tar.gz.sha256 failed"
    signature_file="$archive.sha256.sig"
    # Distinguish "this release predates signing" (404 → empty file, which
    # verify_release_signature fails closed on unless waived) from a
    # transport failure, which must never be misread as a missing signature.
    sig_status=$(curl -sSL --retry 3 --retry-connrefused --connect-timeout 15 --max-time 120 \
      -o "$signature_file" -w '%{http_code}' "$base/$name.tar.gz.sha256.sig") \
      || die "network failure fetching the release signature"
    case "$sig_status" in
      200) ;;
      404) : > "$signature_file" ;;
      *) die "fetching the release signature failed (HTTP $sig_status)" ;;
    esac
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
  trap 'release_lock; rm -rf "$work"' EXIT
  if [ -x "$target/bin/moltnet-agent" ] && [ "$(readlink "$HOME_DIR/current" 2>/dev/null)" = "$target" ]; then
    log "moltnet-agent $version already installed"
  else
    staging=$(mktemp -d "$HOME_DIR/.staging.XXXXXX")
    tar -xzf "$archive" -C "$staging" --strip-components 1
    if [ -e "$staging/UNSIGNED" ] && [ "${MOLTNET_AGENT_ALLOW_UNSIGNED:-0}" != 1 ]; then
      rm -rf "$staging"
      die "this artifact is marked UNSIGNED (built without the release signing identity); refusing to install it. Set MOLTNET_AGENT_ALLOW_UNSIGNED=1 only if you built it yourself."
    fi
    # The signed checksum authenticates the archive BYTES; bind them to the
    # requested version/platform so an older valid archive+checksum+sig trio
    # cannot be replayed under a newer tag. (Local archives derive $version
    # from their own manifest, so the check is a tautology there.)
    staged_version=$(grep -o '"version": *"[^"]*"' "$staging/manifest.json" 2>/dev/null | head -1 | sed 's/.*: *"//; s/"//')
    staged_platform=$(grep -o '"platform": *"[^"]*"' "$staging/manifest.json" 2>/dev/null | head -1 | sed 's/.*: *"//; s/"//')
    if [ "$staged_version" != "$version" ]; then
      rm -rf "$staging"
      die "archive manifest reports version '$staged_version' but $version was requested — possible replay of a different release"
    fi
    if [ "$staged_platform" != "$plat" ]; then
      rm -rf "$staging"
      die "archive manifest is for platform '$staged_platform', not $plat"
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
    if [ -n "${previous_target:-}" ] && [ -d "$previous_target" ] && [ "$previous_target" != "$target" ]; then
      # Upgrade: restore the previous version AND verify its service came
      # back — a rollback that leaves no daemon running must say so.
      ln -sfn "$previous_target" "$HOME_DIR/current"
      mv "$target" "$target.broken" 2>/dev/null || true
      if register_service "$plat"; then
        die "upgrade to $version failed its readiness check; rolled back to $(basename "$previous_target") (broken payload kept at $target.broken)"
      fi
      die "upgrade to $version failed its readiness check AND restoring $(basename "$previous_target") failed its own readiness check — no daemon is running (broken payload kept at $target.broken)"
    fi
    # First install: leave nothing half-registered behind — a retry must
    # start from a clean slate.
    unregister_service
    rm -f "$BIN_DIR/moltnet-agent"
    rm -f "$HOME_DIR/current"
    mv "$target" "$target.broken" 2>/dev/null || true
    die "install of $version failed its readiness check (broken payload kept at $target.broken)"
  fi

  # Prune older versions only after the new one is confirmed running.
  for dir in "$HOME_DIR"/*/; do
    dir=${dir%/}
    case "$dir" in "$target"|*/current|*/.staging.*|*.broken) ;; *) rm -rf "$dir" ;; esac
  done

  sandbox_ready=1
  case "$plat" in
    linux-*)
      # The darwin bundle vendors qemu-img; on Linux both the image tool and
      # the system emulator come from the distro (same contract as the
      # daemon GitHub Action setup: qemu-utils + qemu-system-x86).
      command -v qemu-img >/dev/null 2>&1 \
        || { log "note: qemu-img not found — sandboxed (gondolin) runs need it: apt install qemu-utils / dnf install qemu-img"; sandbox_ready=0; }
      command -v qemu-system-x86_64 >/dev/null 2>&1 \
        || { log "note: qemu-system-x86_64 not found — sandboxed (gondolin) runs need it: apt install qemu-system-x86 / dnf install qemu-system-x86"; sandbox_ready=0; }
      ;;
  esac
  ready_suffix=""
  [ "$sandbox_ready" = 1 ] || ready_suffix=" (sandboxed runs unavailable until the qemu packages above are installed)"
  if "$HOME_DIR/current/bin/moltnet-agent" serve --help >/dev/null 2>&1; then
    log "moltnet-agent $version ready$ready_suffix — open the Console's Local runtime page to pair."
  else
    log "moltnet-agent $version ready$ready_suffix."
  fi
}

usage() {
  cat <<'EOF'
moltnet-agent installer — curl -fsSL https://get.themolt.net | sh

Installs the signed bundle under ~/.local/share/moltnet/agent/<version>,
links `moltnet-agent` on PATH, and registers `moltnet-agent serve` as a
login service (LaunchAgent on macOS, systemd user unit on Linux).
Re-running upgrades in place; --uninstall removes what the installer created.

Environment overrides:
  MOLTNET_AGENT_VERSION       version to install (default: latest release)
  MOLTNET_AGENT_BASE_URL      release asset base URL
  MOLTNET_AGENT_ARCHIVE       local .tar.gz (skips download; .sha256 beside it)
  MOLTNET_AGENT_HOME          install root (default ~/.local/share/moltnet/agent)
  MOLTNET_AGENT_BIN_DIR       bin link directory (default ~/.local/bin)
  MOLTNET_AGENT_NO_SERVICE=1  skip service registration

Trust-chain escape hatches (only for artifacts you built yourself):
  MOLTNET_AGENT_ALLOW_UNSIGNED=1    accept an artifact carrying the UNSIGNED
                                    marker (waives the Apple code-signing chain)
  MOLTNET_AGENT_ALLOW_UNVERIFIED=1  skip release-signature verification
                                    (waives the publisher trust chain)
EOF
}

case "${1:-}" in
  --uninstall) uninstall ;;
  -h|--help) usage ;;
  "") install ;;
  *) die "unknown argument: $1" ;;
esac
