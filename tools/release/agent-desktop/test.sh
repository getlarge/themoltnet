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
for (const route of [
  '/download/desktop/macos-arm64',
  '/download/desktop/linux-x64-deb',
  '/download/desktop/linux-x64-appimage',
]) {
  if (!manifestTemplate.includes(`location = ${route}`)) {
    throw new Error(`download manifest is missing Desktop route ${route}`);
  }
}
for (const suffix of ['aarch64.dmg', 'amd64.deb', 'amd64.AppImage']) {
  if (!manifestTemplate.includes(`MoltNet-Agent_\${agent_desktop_version}_${suffix}`)) {
    throw new Error(`download manifest is missing Desktop artifact ${suffix}`);
  }
}
NODE

# Linux signing does not require Apple material; all update formats are required.
TAURI_UPDATER_PUBLIC_KEY='trusted-updater-key' \
  TAURI_SIGNING_PRIVATE_KEY='private-updater-key' \
  bash "$repo/tools/release/agent-desktop/validate.sh" "$fixture" --release linux

# GitHub's releases/tags endpoint excludes drafts. Exercise the collection
# lookup used by finalization with a fake gh response so that contract stays
# testable without creating a release.
mkdir -p "$fixture/bin"
cat > "$fixture/bin/gh" <<'SH'
#!/usr/bin/env bash
cat "$FAKE_RELEASES"
SH
chmod +x "$fixture/bin/gh"
printf '%s\n' \
  '[{"tag_name":"agent-desktop-v1.2.3","draft":true,"assets":[]}]' \
  > "$fixture/releases.json"
PATH="$fixture/bin:$PATH" \
  GITHUB_REPOSITORY=getlarge/themoltnet \
  RELEASE_TAG=agent-desktop-v1.2.3 \
  FAKE_RELEASES="$fixture/releases.json" \
  bash "$repo/tools/release/agent-desktop/fetch-release.sh" "$fixture/draft.json"
[ "$(jq -r .tag_name "$fixture/draft.json")" = agent-desktop-v1.2.3 ]
printf '%s\n' \
  '[{"tag_name":"agent-desktop-v1.2.3","draft":false,"assets":[]}]' \
  > "$fixture/releases.json"
if PATH="$fixture/bin:$PATH" \
  GITHUB_REPOSITORY=getlarge/themoltnet \
  RELEASE_TAG=agent-desktop-v1.2.3 \
  FAKE_RELEASES="$fixture/releases.json" \
  bash "$repo/tools/release/agent-desktop/fetch-release.sh" "$fixture/draft.json" 2>/dev/null; then
  echo 'draft lookup accepted a published release' >&2
  exit 1
fi

mkdir -p "$fixture/assets" "$fixture/metadata" "$fixture/output"
node --input-type=module - "$fixture/assets" <<'NODE'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DESKTOP_PLATFORMS,
  desktopAssetName,
} from './tools/release/agent-desktop/release-contract.mjs';

const directory = process.argv[2];
for (const { artifacts } of Object.values(DESKTOP_PLATFORMS)) {
  for (const { suffix, updater } of artifacts) {
    const path = join(directory, desktopAssetName('1.2.3', suffix));
    writeFileSync(path, 'artifact');
    if (updater) writeFileSync(`${path}.sig`, 'signature');
  }
}
NODE
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
    state: 'uploaded',
  }));
fs.writeFileSync(output, JSON.stringify({ assets }));
NODE
cp "$fixture/published.json" "$fixture/published-good.json"
node tools/release/agent-desktop/verify-published-assets.mjs \
  "$fixture/metadata" "$fixture/published.json" 1.2.3
node tools/release/agent-desktop/manifest.mjs \
  "$fixture/metadata" "$fixture/output/latest.json" 1.2.3
[ ! -e "$fixture/metadata/latest.json" ]
node tools/release/agent-desktop/verify-published-assets.mjs \
  "$fixture/metadata" "$fixture/published.json" 1.2.3 \
  "$fixture/output/latest.json" optional
node - "$fixture/published.json" "$fixture/output/latest.json" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [publishedPath, manifestPath] = process.argv.slice(2);
const published = require(publishedPath);
const bytes = fs.readFileSync(manifestPath);
published.assets.push({
  name: 'latest.json',
  size: bytes.length,
  digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
  state: 'uploaded',
});
fs.writeFileSync(publishedPath, JSON.stringify(published));
NODE
node tools/release/agent-desktop/verify-published-assets.mjs \
  "$fixture/metadata" "$fixture/published.json" 1.2.3 \
  "$fixture/output/latest.json" required
node - "$fixture/output/latest.json" <<'NODE'
const manifest = require(process.argv[2]);
const targets = Object.keys(manifest.platforms).sort();
if (JSON.stringify(targets) !== JSON.stringify(['darwin-aarch64', 'linux-x86_64-appimage', 'linux-x86_64-deb'])) {
  throw new Error('Updater must select the installed package format');
}
NODE
cp "$fixture/published-good.json" "$fixture/published.json"
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

for failure in missing size extra digest; do
  cp "$fixture/published-good.json" "$fixture/published-$failure.json"
  node - "$fixture/published-$failure.json" "$failure" <<'NODE'
const fs = require('node:fs');
const [path, failure] = process.argv.slice(2);
const published = require(path);
if (failure === 'missing') published.assets.shift();
if (failure === 'size') published.assets[0].size += 1;
if (failure === 'extra') published.assets.push({ name: 'unexpected.bin', size: 1, digest: `sha256:${'0'.repeat(64)}`, state: 'uploaded' });
if (failure === 'digest') published.assets[0].digest = null;
fs.writeFileSync(path, JSON.stringify(published));
NODE
  if node tools/release/agent-desktop/verify-published-assets.mjs \
    "$fixture/metadata" "$fixture/published-$failure.json" 1.2.3 \
    2>"$fixture/$failure.err"; then
    echo "published asset verification accepted a $failure release" >&2
    exit 1
  fi
done
grep -q 'missing .*; extra' "$fixture/missing.err"
grep -q 'expected .*found' "$fixture/size.err"
grep -q 'expected .*found none.*Rerunning finalization is safe' "$fixture/digest.err"

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

echo 'agent desktop release contract tests passed'
