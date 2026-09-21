#!/usr/bin/env bash
set -euo pipefail

repo=$(pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/moltnet-agent-desktop-release.XXXXXX")
trap 'rm -rf "$fixture"' EXIT

mkdir -p \
  "$fixture/apps/agent-desktop/src-tauri" \
  "$fixture/apps/landing/nginx" \
  "$fixture/apps/landing"

printf '%s\n' '{"version":"1.2.3"}' > "$fixture/apps/agent-desktop/package.json"
printf '%s\n' '[package]' 'version = "1.2.3"' > "$fixture/apps/agent-desktop/src-tauri/Cargo.toml"
printf '%s\n' '{"version":"1.2.3"}' > "$fixture/apps/agent-desktop/src-tauri/tauri.conf.json"
printf '%s\n' '0.57.0' > "$fixture/apps/agent-desktop/agent-cli.version"
printf '%s\n' \
  'const RELEASE_SIGNER_PUBKEY: &str =' \
  '    "ssh-ed25519 AAAATEST";' \
  > "$fixture/apps/agent-desktop/src-tauri/build.rs"
printf '%s\n' \
  '    set $cli_version 2.4.0;' \
  '    set $agent_cli_version 0.57.0;' \
  '    set $agent_desktop_version 1.2.3;' \
  > "$fixture/apps/landing/nginx/default.conf.template"
printf '%s\n' '  RELEASE_SIGNER_PUBKEY = "ssh-ed25519 AAAATEST"' > "$fixture/apps/landing/fly.toml"
printf '%s\n' 'rust 1.88.0' > "$fixture/.tool-versions"

bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture"

TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  APPLE_CERT_P12='certificate' \
  APPLE_CERT_PASSWORD='password' \
  NOTARY_KEY='notary-key' \
  NOTARY_ISSUER_ID='issuer' \
  NOTARY_KEY_ID='key-id' \
  AGENT_CLI_RELEASE_TAG='agent-daemon-v0.58.0' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release

if TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  APPLE_CERT_P12='certificate' \
  APPLE_CERT_PASSWORD='password' \
  NOTARY_KEY='notary-key' \
  NOTARY_ISSUER_ID='issuer' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release 2>/dev/null; then
  echo 'release validation accepted incomplete notarization credentials' >&2
  exit 1
fi

printf '%s\n' '0.56.2' > "$fixture/apps/agent-desktop/agent-cli.version"
if bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" 2>/dev/null; then
  echo 'validation accepted a desktop Agent CLI pin that differs from the public pin' >&2
  exit 1
fi
printf '%s\n' '0.57.0' > "$fixture/apps/agent-desktop/agent-cli.version"

TEMPLATE="$fixture/apps/landing/nginx/default.conf.template" \
AGENT_CLI_PIN_FILE="$fixture/apps/agent-desktop/agent-cli.version" \
CLI_VERSION=2.5.0 \
AGENT_CLI_VERSION=0.58.0 \
AGENT_DESKTOP_VERSION=1.3.0 \
bash "$repo/tools/release/propose-download-pin.sh"

grep -q '^    set \$cli_version 2\.5\.0;$' "$fixture/apps/landing/nginx/default.conf.template"
grep -q '^    set \$agent_cli_version 0\.58\.0;$' "$fixture/apps/landing/nginx/default.conf.template"
grep -q '^    set \$agent_desktop_version 1\.3\.0;$' "$fixture/apps/landing/nginx/default.conf.template"
[ "$(cat "$fixture/apps/agent-desktop/agent-cli.version")" = '0.58.0' ]

if TEMPLATE="$fixture/apps/landing/nginx/default.conf.template" \
  AGENT_CLI_PIN_FILE="$fixture/apps/agent-desktop/agent-cli.version" \
  AGENT_CLI_VERSION=0.57.0 \
  bash "$repo/tools/release/propose-download-pin.sh" 2>/dev/null; then
  echo 'pin updater accepted an Agent CLI downgrade' >&2
  exit 1
fi
grep -q '^    set \$agent_cli_version 0\.58\.0;$' "$fixture/apps/landing/nginx/default.conf.template"
[ "$(cat "$fixture/apps/agent-desktop/agent-cli.version")" = '0.58.0' ]

if TEMPLATE="$fixture/apps/landing/nginx/default.conf.template" \
  AGENT_CLI_PIN_FILE="$fixture/apps/agent-desktop/agent-cli.version" \
  AGENT_CLI_VERSION=01.2.3 \
  bash "$repo/tools/release/propose-download-pin.sh" 2>/dev/null; then
  echo 'pin updater accepted a noncanonical version' >&2
  exit 1
fi

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

const manifestTemplate = fs.readFileSync(
  'apps/landing/nginx/default.conf.template',
  'utf8',
);
for (const field of ['agent', 'agentCli']) {
  const expectedField = `"${field}":{"version":"$agent_cli_version","tag":"agent-daemon-v$agent_cli_version"}`;
  if (!manifestTemplate.includes(expectedField)) {
    throw new Error(`download manifest is missing compatible ${field} data`);
  }
}
NODE

echo 'agent desktop release contract tests passed'

# Linux signing does not require Apple material; all update formats are required.
TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release linux
mkdir -p "$fixture/assets" "$fixture/metadata" "$fixture/output"
for suffix in aarch64.app.tar.gz amd64.deb amd64.AppImage; do
  printf 'artifact' > "$fixture/assets/MoltNet-Agent_1.2.3_$suffix"
  printf 'signature' > "$fixture/assets/MoltNet-Agent_1.2.3_$suffix.sig"
done
for suffix in aarch64.app.zip aarch64.dmg; do
  printf 'artifact' > "$fixture/assets/MoltNet-Agent_1.2.3_$suffix"
done
node tools/release/agent-desktop/release-metadata.mjs \
  "$fixture/assets" 1.2.3 mac-os "$fixture/metadata/release-metadata-mac-os.json"
node tools/release/agent-desktop/release-metadata.mjs \
  "$fixture/assets" 1.2.3 linux "$fixture/metadata/release-metadata-linux.json"
node - "$fixture/metadata" "$fixture/published.json" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [directory, output] = process.argv.slice(2);
const assets = fs.readdirSync(directory)
  .filter((name) => name.startsWith('release-metadata-'))
  .flatMap((name) => require(path.join(directory, name)).assets)
  .map((asset) => ({
    name: asset.name,
    size: asset.size,
    digest: `sha256:${asset.sha256}`,
  }));
fs.writeFileSync(output, JSON.stringify({ assets }));
NODE
node tools/release/agent-desktop/verify-published-assets.mjs \
  "$fixture/metadata" "$fixture/published.json" 1.2.3
node tools/release/agent-desktop/manifest.mjs \
  "$fixture/metadata" "$fixture/output/latest.json" 1.2.3
[ ! -e "$fixture/metadata/latest.json" ]
node - "$fixture/output/latest.json" <<'NODE'
const manifest = require(process.argv[2]);
const targets = Object.keys(manifest.platforms).sort();
if (JSON.stringify(targets) !== JSON.stringify(['darwin-aarch64', 'linux-x86_64-appimage', 'linux-x86_64-deb'])) {
  throw new Error('Updater must select the installed package format');
}
NODE
node - "$fixture/published.json" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const published = require(path);
const appImage = published.assets.find((asset) => asset.name.endsWith('.AppImage'));
if (!appImage) throw new Error('AppImage fixture is missing');
appImage.digest = `sha256:${'0'.repeat(64)}`;
fs.writeFileSync(path, JSON.stringify(published));
NODE
if node tools/release/agent-desktop/verify-published-assets.mjs \
  "$fixture/metadata" "$fixture/published.json" 1.2.3 2>/dev/null; then
  echo 'published asset verification accepted a changed digest' >&2
  exit 1
fi
node - "$fixture/metadata/release-metadata-linux.json" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const metadata = require(path);
metadata.assets = metadata.assets.filter((asset) => !asset.name.endsWith('.deb'));
fs.writeFileSync(path, JSON.stringify(metadata));
NODE
if node tools/release/agent-desktop/manifest.mjs \
  "$fixture/metadata" "$fixture/output/latest.json" 1.2.3 2>/dev/null; then
  echo 'manifest accepted an incomplete Linux release' >&2
  exit 1
fi
