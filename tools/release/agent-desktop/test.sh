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
