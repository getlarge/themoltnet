#!/usr/bin/env bash
# Print the publisher release-signing public key (`ssh-ed25519 <base64>`).
#
# apps/rest-api/fly.toml is the only maintained copy: rest-api serves it in
# /.well-known/moltnet.json, release jobs embed it into the installers, and
# the Desktop validator checks its embedded copy against it. Release jobs
# still derive the public key from RELEASE_SIGNING_KEY and refuse to publish
# on a mismatch, so a changed line here cannot sign anything by itself.
set -euo pipefail

root=${1:-.}
fly_toml="$root/apps/rest-api/fly.toml"

[ -f "$fly_toml" ] || { echo "missing $fly_toml" >&2; exit 1; }
key=$(sed -nE 's/^  RELEASE_SIGNER_PUBKEY = "(ssh-ed25519 [A-Za-z0-9+\/]+={0,2})"$/\1/p' "$fly_toml")
[ "$(printf '%s' "$key" | grep -c .)" = 1 ] || {
  echo "expected exactly one bare ssh-ed25519 RELEASE_SIGNER_PUBKEY in $fly_toml" >&2
  exit 1
}
printf '%s\n' "$key"
