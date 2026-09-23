#!/usr/bin/env bash
# Refuse desktop builds whose embedded Agent CLI trust material or release
# signing inputs are incomplete. Artifact-level Apple checks run after bundle.
set -euo pipefail

root=${1:-.}
package_json="$root/apps/agent-desktop/package.json"
cargo_toml="$root/apps/agent-desktop/src-tauri/Cargo.toml"
tauri_config="$root/apps/agent-desktop/src-tauri/tauri.conf.json"
build_rs="$root/apps/agent-desktop/src-tauri/build.rs"
agent_cli_minimum_file="$root/apps/agent-desktop/agent-cli.minimum-version"

valid_version() { [[ $1 =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }
version_at_least() {
  local candidate_major candidate_minor candidate_patch
  local floor_major floor_minor floor_patch
  IFS=. read -r candidate_major candidate_minor candidate_patch <<< "$1"
  IFS=. read -r floor_major floor_minor floor_patch <<< "$2"
  ((
    candidate_major > floor_major ||
      (candidate_major == floor_major && candidate_minor > floor_minor) ||
      (candidate_major == floor_major && candidate_minor == floor_minor && candidate_patch >= floor_patch)
  ))
}

package_version=$(node -p "require(process.argv[1]).version" "$package_json")
tauri_version=$(node -p "require(process.argv[1]).version" "$tauri_config")
cargo_version=$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_toml" | head -1)
[ "$package_version" = "$tauri_version" ] && [ "$package_version" = "$cargo_version" ] || {
  echo "desktop package, Tauri, and Cargo versions must match" >&2
  exit 1
}

minimum_agent_cli_version=$(tr -d '\n' < "$agent_cli_minimum_file")
[ -n "$minimum_agent_cli_version" ] || {
  echo "minimum Agent CLI version is empty or invalid" >&2
  exit 1
}
valid_version "$minimum_agent_cli_version" || {
  echo "minimum Agent CLI version is not canonical" >&2
  exit 1
}
if [ -n "${MOLTNET_AGENT_CLI_VERSION:-}" ]; then
  valid_version "$MOLTNET_AGENT_CLI_VERSION" || {
    echo "selected Agent CLI version is not canonical: $MOLTNET_AGENT_CLI_VERSION" >&2
    exit 1
  }
  version_at_least "$MOLTNET_AGENT_CLI_VERSION" "$minimum_agent_cli_version" || {
    echo "selected Agent CLI version $MOLTNET_AGENT_CLI_VERSION is below the Desktop minimum $minimum_agent_cli_version" >&2
    exit 1
  }
elif [ "${2:-}" = "--release" ]; then
  echo "MOLTNET_AGENT_CLI_VERSION is required for release packaging" >&2
  exit 1
fi

embedded_key=$(sed -nE 's/^    "(ssh-ed25519 [^"]+)";/\1/p' "$build_rs")
# apps/rest-api/fly.toml holds the only maintained copy of the trust anchor.
api_key=$(bash "$(dirname "$0")/../release-signer-pubkey.sh" "$root")
[ -n "$embedded_key" ] && [ "$embedded_key" = "$api_key" ] || {
  echo "embedded Agent CLI trust anchor does not match the reviewed rest-api anchor" >&2
  exit 1
}

platform=${3:-mac-os}
case "$platform" in mac-os|linux) ;; *) echo "Unknown desktop platform: $platform" >&2; exit 1 ;; esac

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
fi

if [ "${2:-}" = "--release" ] && [ "$platform" = mac-os ]; then
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
