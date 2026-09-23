#!/usr/bin/env bash
set -euo pipefail

node --test \
  tools/release/agent-desktop/boundary.test.mjs \
  tools/release/agent-desktop/release-contract.test.mjs

repo=$(pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/moltnet-agent-desktop-release.XXXXXX")
trap 'rm -rf "$fixture"' EXIT

mkdir -p \
  "$fixture/apps/agent-desktop/src-tauri" \
  "$fixture/apps/rest-api"

printf '%s\n' '{"version":"1.2.3"}' > "$fixture/apps/agent-desktop/package.json"
printf '%s\n' '[package]' 'version = "1.2.3"' > "$fixture/apps/agent-desktop/src-tauri/Cargo.toml"
printf '%s\n' '{"version":"1.2.3"}' > "$fixture/apps/agent-desktop/src-tauri/tauri.conf.json"
printf '%s\n' '0.57.0' > "$fixture/apps/agent-desktop/agent-cli.minimum-version"
printf '%s\n' \
  'const RELEASE_SIGNER_PUBKEY: &str =' \
  '    "ssh-ed25519 AAAATEST";' \
  > "$fixture/apps/agent-desktop/src-tauri/build.rs"
printf '%s\n' '  RELEASE_SIGNER_PUBKEY = "ssh-ed25519 AAAATEST"' > "$fixture/apps/rest-api/fly.toml"
printf '%s\n' 'rust 1.88.0' > "$fixture/.tool-versions"

validate_release() {
  TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
    TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
    APPLE_CERT_P12='certificate' \
    APPLE_CERT_PASSWORD='password' \
    NOTARY_KEY='notary-key' \
    NOTARY_ISSUER_ID='issuer' \
    NOTARY_KEY_ID='key-id' \
    MOLTNET_AGENT_CLI_VERSION="${1:-}" \
    bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release
}

bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture"
validate_release '0.57.0'

# The trust anchor must be exactly one bare ssh-ed25519 key in rest-api's
# fly.toml; anything else is refused rather than guessed at.
api_fly="$fixture/apps/rest-api/fly.toml"
cp "$api_fly" "$fixture/api-fly.toml.orig"
for bad in \
  '  RELEASE_SIGNER_PUBKEY = "ssh-ed25519 AAAATEST legreffier@themolt.net"' \
  '  RELEASE_SIGNER_PUBKEY = "ssh-rsa AAAATEST"' \
  "$(printf '%s\n%s' '  RELEASE_SIGNER_PUBKEY = "ssh-ed25519 AAAATEST"' '  RELEASE_SIGNER_PUBKEY = "ssh-ed25519 AAAAOTHER"')" \
  '# no key'; do
  printf '%s\n' "$bad" > "$api_fly"
  if bash "$repo/tools/release/release-signer-pubkey.sh" "$fixture" >/dev/null 2>&1; then
    echo "release signer key extraction accepted: $bad" >&2
    exit 1
  fi
done
cp "$fixture/api-fly.toml.orig" "$api_fly"
[ "$(bash "$repo/tools/release/release-signer-pubkey.sh" "$fixture")" = 'ssh-ed25519 AAAATEST' ]

if TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  APPLE_CERT_P12='certificate' \
  APPLE_CERT_PASSWORD='password' \
  NOTARY_KEY='notary-key' \
  NOTARY_ISSUER_ID='issuer' \
  MOLTNET_AGENT_CLI_VERSION='0.57.0' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release 2>/dev/null; then
  echo 'release validation accepted incomplete notarization credentials' >&2
  exit 1
fi

printf '%s\n' '0.58.0' > "$fixture/apps/agent-desktop/agent-cli.minimum-version"
if validate_release '0.57.0' 2>/dev/null; then
  echo 'release validation accepted an Agent CLI version below the minimum' >&2
  exit 1
fi
bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture"
if validate_release 2>/dev/null; then
  echo 'release validation accepted no selected Agent CLI version' >&2
  exit 1
fi
validate_release '0.58.0'
validate_release '0.59.0'
printf '%s\n' '0.57.0' > "$fixture/apps/agent-desktop/agent-cli.minimum-version"

node - <<'NODE'
const fs = require('node:fs');
const config = require('./release-please-config.json');
const files = config.packages['apps/agent-desktop']['extra-files'];
const expected = new Map([
  ['src-tauri/tauri.conf.json', '$.version'],
  ['src-tauri/Cargo.toml', '$.package.version'],
  [
    'src-tauri/Cargo.lock',
    "$.package[?(@.name.value=='moltnet-agent-desktop')].version",
  ],
]);
for (const file of files) {
  if (expected.get(file.path) === file.jsonpath) expected.delete(file.path);
}
if (expected.size) {
  throw new Error(`missing desktop release version updaters: ${[...expected.keys()]}`);
}
const tauriConfigPath = 'apps/agent-desktop/src-tauri/tauri.conf.json';
const tauriConfig = fs.readFileSync(tauriConfigPath, 'utf8');
const releasePleaseLayout = `${JSON.stringify(JSON.parse(tauriConfig), null, 2)}\n`;
if (tauriConfig !== releasePleaseLayout) {
  throw new Error(
    `${tauriConfigPath} must match Release Please's JSON serializer`,
  );
}
NODE

# Linux signing does not require Apple material; all update formats are required.
TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  MOLTNET_AGENT_CLI_VERSION='0.57.0' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release linux

# Exercise the exact selector shared by notarization and materialization.
source "$repo/tools/release/agent-desktop/find-one.sh"
for platform in mac-os linux; do
  selector="$fixture/select-$platform"
  mkdir -p "$selector"
  if [ "$platform" = mac-os ]; then
    pattern='*_1.2.3_*.dmg'
    if find_one "$selector" "$pattern" >/dev/null 2>&1; then
      echo 'macOS selector accepted zero artifacts' >&2
      exit 1
    fi
    touch "$selector/MoltNet-Agent_1.2.3_aarch64.dmg"
    [ "$(find_one "$selector" "$pattern")" = "$selector/MoltNet-Agent_1.2.3_aarch64.dmg" ]
    touch "$selector/stale_1.2.3_aarch64.dmg"
    if find_one "$selector" "$pattern" >/dev/null 2>&1; then
      echo 'macOS selector accepted duplicate artifacts' >&2
      exit 1
    fi
  else
    pattern='*_1.2.3_*.deb'
    if find_one "$selector" "$pattern" >/dev/null 2>&1; then
      echo 'Linux selector accepted zero artifacts' >&2
      exit 1
    fi
    touch "$selector/MoltNet-Agent_1.2.3_amd64.deb"
    [ "$(find_one "$selector" "$pattern")" = "$selector/MoltNet-Agent_1.2.3_amd64.deb" ]
    touch "$selector/stale_1.2.3_amd64.deb"
    if find_one "$selector" "$pattern" >/dev/null 2>&1; then
      echo 'Linux selector accepted duplicate artifacts' >&2
      exit 1
    fi
  fi
done

# Publish against a fake GitHub: the draft must still target the packaged
# revision, GitHub's asynchronous digest processing is waited out, and only a
# fully verified upload is un-drafted.
publish_fake="$fixture/publish"
mkdir -p "$publish_fake/bin" "$publish_fake/assets" "$publish_fake/uploaded"
node --input-type=module - "$publish_fake/assets" <<'NODE'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectedAssetNames } from './tools/release/agent-desktop/release-contract.mjs';
for (const name of expectedAssetNames('1.2.3')) {
  writeFileSync(join(process.argv[2], name), `bytes-of-${name}`);
}
NODE
cat > "$publish_fake/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
state=$FAKE_GH_STATE
case "$*" in
  'release view agent-desktop-v1.2.3 --repo getlarge/themoltnet --json isDraft,targetCommitish')
    printf '{"isDraft":true,"targetCommitish":"%s"}\n' "$FAKE_TARGET" ;;
  'api repos/getlarge/themoltnet/commits/agent-desktop-v1.2.3 --jq .sha')
    printf '%s\n' "$FAKE_TARGET" ;;
  "api repos/getlarge/themoltnet/compare/$FAKE_TARGET...main --jq .status")
    echo ahead ;;
  "api repos/getlarge/themoltnet/contents/apps/agent-desktop/package.json?ref=$FAKE_TARGET -H Accept: application/vnd.github.raw")
    echo '{"version":"1.2.3"}' ;;
  'release upload agent-desktop-v1.2.3 '*)
    shift 3
    while [ "$1" != --repo ]; do cp "$1" "$state/uploaded/"; shift; done ;;
  'release view agent-desktop-v1.2.3 --repo getlarge/themoltnet --json databaseId --jq .databaseId')
    echo 42 ;;
  'api --paginate repos/getlarge/themoltnet/releases/42/assets?per_page=100')
    polls=$(( $(cat "$state/polls" 2>/dev/null || echo 0) + 1 ))
    echo "$polls" > "$state/polls"
    node - "$state/uploaded" "$polls" <<'NODE'
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const [directory, polls] = process.argv.slice(2);
console.log(JSON.stringify(fs.readdirSync(directory).map((name, index) => {
  const bytes = fs.readFileSync(`${directory}/${name}`);
  const processing = polls === '1' && index === 0;
  return {
    name,
    size: bytes.length,
    state: 'uploaded',
    digest: processing ? null : `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
})));
NODE
    ;;
  'release edit agent-desktop-v1.2.3 --repo getlarge/themoltnet --draft=false')
    touch "$state/published" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
SH
chmod +x "$publish_fake/bin/gh"
publish() {
  PATH="$publish_fake/bin:$PATH" \
    FAKE_GH_STATE="$publish_fake" \
    FAKE_TARGET="$(printf 'a%.0s' {1..40})" \
    GITHUB_REPOSITORY=getlarge/themoltnet \
    RELEASE_TAG=agent-desktop-v1.2.3 \
    RUNNER_TEMP="$publish_fake" \
    PUBLISH_POLL_SECONDS=0 \
    REVISION="$1" \
    bash "$repo/tools/release/agent-desktop/publish.sh" "$publish_fake/assets"
}
if publish "$(printf 'b%.0s' {1..40})" 2>/dev/null; then
  echo 'publish accepted a draft that moved to another revision' >&2
  exit 1
fi
[ ! -e "$publish_fake/published" ] && [ -z "$(ls "$publish_fake/uploaded")" ]
publish "$(printf 'a%.0s' {1..40})" >/dev/null 2>&1
[ -e "$publish_fake/published" ]
[ "$(cat "$publish_fake/polls")" = 2 ]
[ -s "$publish_fake/uploaded/latest.json" ]

# Stage a Desktop's pinned daemon through the real installer. The installer
# only accepts an archive for the host platform, so this runs on linux-x64.
if [ "$(uname -sm)" = 'Linux x86_64' ]; then
  signer="$fixture/signer"
  daemon="$fixture/daemon"
  payload="$daemon/moltnet-agent-linux-x64"
  archive="$daemon/moltnet-agent-linux-x64.tar.gz"
  mkdir -p "$signer/apps/rest-api" "$payload/bin"
  ssh-keygen -q -t ed25519 -N '' -C release -f "$signer/key"
  ssh-keygen -q -t ed25519 -N '' -C other -f "$signer/other"
  printf '  RELEASE_SIGNER_PUBKEY = "%s"\n' "$(cut -d' ' -f1-2 "$signer/key.pub")" \
    > "$signer/apps/rest-api/fly.toml"
  printf '#!/bin/sh\nexit 0\n' > "$payload/bin/moltnet-agent"
  chmod +x "$payload/bin/moltnet-agent"
  printf '{"version":"0.58.0","platform":"linux-x64"}\n' > "$payload/manifest.json"
  tar -czf "$archive" -C "$daemon" moltnet-agent-linux-x64
  (cd "$daemon" && sha256sum moltnet-agent-linux-x64.tar.gz > moltnet-agent-linux-x64.tar.gz.sha256)
  stage() {
    RELEASE_SIGNER_ROOT="$signer" \
      bash "$repo/tools/release/agent-desktop/stage-agent.sh" "$1" "$fixture/staged-$1" "$daemon"
  }

  ssh-keygen -q -Y sign -f "$signer/key" -n moltnet-release "$archive.sha256"
  stage 0.58.0
  cmp "$archive" "$fixture/staged-0.58.0/moltnet-agent-linux-x64.tar.gz"
  if stage 0.59.0 2>/dev/null; then
    echo 'daemon staging accepted a payload for a different version' >&2
    exit 1
  fi

  rm "$archive.sha256.sig"
  ssh-keygen -q -Y sign -f "$signer/other" -n moltnet-release "$archive.sha256"
  rm -rf "$fixture/staged-0.58.0"
  if stage 0.58.0 2>/dev/null; then
    echo 'daemon staging accepted a payload signed by another key' >&2
    exit 1
  fi
else
  echo 'skipping Agent Daemon staging test: the installer only stages the host platform (linux-x64)'
fi

echo 'agent desktop release contract tests passed'
