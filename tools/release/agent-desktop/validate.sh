#!/usr/bin/env bash
# Refuse desktop builds whose embedded Agent CLI trust material or release
# signing inputs are incomplete. Artifact-level Apple checks run after bundle.
set -euo pipefail

root=${1:-.}
package_json="$root/apps/agent-desktop/package.json"
cargo_toml="$root/apps/agent-desktop/src-tauri/Cargo.toml"
tauri_config="$root/apps/agent-desktop/src-tauri/tauri.conf.json"
build_rs="$root/apps/agent-desktop/src-tauri/build.rs"
landing_fly="$root/apps/landing/fly.toml"

valid_version() { [[ $1 =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }

package_version=$(node -p "require('./$package_json').version")
tauri_version=$(node -p "require('./$tauri_config').version")
cargo_version=$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_toml" | head -1)
[ "$package_version" = "$tauri_version" ] && [ "$package_version" = "$cargo_version" ] || {
  echo "desktop package, Tauri, and Cargo versions must match" >&2
  exit 1
}

agent_cli_version=$(sed -nE 's/^const DEFAULT_AGENT_CLI_VERSION: &str = "([0-9]+\.[0-9]+\.[0-9]+)";/\1/p' "$build_rs")
[ -n "$agent_cli_version" ] || {
  echo "embedded Agent CLI release pin is empty or invalid" >&2
  exit 1
}
valid_version "$agent_cli_version" || {
  echo "embedded Agent CLI release pin is not canonical" >&2
  exit 1
}
if [ -n "${AGENT_CLI_RELEASE_TAG:-}" ]; then
  case "$AGENT_CLI_RELEASE_TAG" in
    agent-daemon-v*) agent_cli_version=${AGENT_CLI_RELEASE_TAG#agent-daemon-v} ;;
    *) echo "invalid Agent CLI release tag: $AGENT_CLI_RELEASE_TAG" >&2; exit 1 ;;
  esac
  valid_version "$agent_cli_version" || {
    echo "invalid Agent CLI release version: $agent_cli_version" >&2
    exit 1
  }
fi

embedded_key=$(sed -nE 's/^    "(ssh-ed25519 [^"]+)";/\1/p' "$build_rs")
landing_key=$(sed -nE 's/^  RELEASE_SIGNER_PUBKEY = "(ssh-ed25519 [^"]+)"/\1/p' "$landing_fly")
[ -n "$embedded_key" ] && [ "$embedded_key" = "$landing_key" ] || {
  echo "embedded Agent CLI trust anchor does not match the reviewed landing anchor" >&2
  exit 1
}

grep -q '^rust 1\.88\.0$' "$root/.tool-versions" || {
  echo "Rust 1.88.0 must be pinned through .tool-versions" >&2
  exit 1
}

if [ "${2:-}" = "--release" ]; then
  [ -n "${TAURI_UPDATER_PUBLIC_KEY:-}" ] || {
    echo "TAURI_UPDATER_PUBLIC_KEY is required for release packaging" >&2
    exit 1
  }
  case "$TAURI_UPDATER_PUBLIC_KEY" in
    *__MOLTNET_TAURI_UPDATER_PUBLIC_KEY__*)
      echo "TAURI_UPDATER_PUBLIC_KEY still contains the updater placeholder" >&2
      exit 1
      ;;
  esac
  [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || {
    echo "TAURI_SIGNING_PRIVATE_KEY is required for updater artifacts" >&2
    exit 1
  }
  [ -n "${APPLE_CERT_P12:-}" ] || {
    echo "APPLE_CERT_P12 is required for Developer ID signing" >&2
    exit 1
  }
  [ -n "${APPLE_CERT_PASSWORD:-}" ] || {
    echo "APPLE_CERT_PASSWORD is required for Developer ID signing" >&2
    exit 1
  }
  [ -n "${NOTARY_KEY:-}" ] || {
    echo "NOTARY_KEY is required for notarization" >&2
    exit 1
  }
  [ -n "${NOTARY_ISSUER_ID:-}" ] && [ -n "${NOTARY_KEY_ID:-}" ] || {
    echo "NOTARY_ISSUER_ID and NOTARY_KEY_ID are required for notarization" >&2
    exit 1
  }
fi

echo "agent desktop release material is complete"
